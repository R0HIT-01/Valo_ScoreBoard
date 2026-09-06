import { google } from "googleapis";
import { CONFIG, validateMatchData, sanitizeMatchData } from "../utils/validation.js";

export class GoogleSheetsService {
  constructor() {
    this.appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || null;
    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || null;
    this.sheetsClient = null;
  }

  isConfigured() {
    return Boolean(
      process.env.GOOGLE_APPS_SCRIPT_URL ||
      (process.env.GOOGLE_SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL)
    );
  }

  /**
   * Helper to perform HTTP POST requests to Google Apps Script Web App
   */
  async _postToAppsScript(payload) {
    const url = process.env.GOOGLE_APPS_SCRIPT_URL || this.appsScriptUrl;
    if (!url) {
      throw new Error("Google Sheets integration not configured (GOOGLE_APPS_SCRIPT_URL missing)");
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "follow",
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON response from Apps Script: ${text.slice(0, 200)}`);
      }

      return data;
    } catch (error) {
      console.error("[SHEETS-SERVICE] Apps Script HTTP Error:", error.message);
      throw error;
    }
  }

  /**
   * Initialize Google Sheets structure idempotently
   */
  async initialize() {
    if (process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log("[SHEETS-SERVICE] Initializing spreadsheet via Apps Script Web App...");
      const result = await this._postToAppsScript({ action: "init" });
      if (!result.success) {
        throw new Error(result.error?.message || "Apps Script initialization failed");
      }
      return result;
    }

    if (this.spreadsheetId && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      return this._initializeDirectClient();
    }

    throw new Error("Google Sheets integration is not configured. Add GOOGLE_APPS_SCRIPT_URL to .env");
  }

  _initializeDirectClient() {
    if (this.sheetsClient) return this.sheetsClient;
    const credentials = {
      type: "service_account",
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || "key-id",
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n"),
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID || "client-id",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    };

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheetsClient = google.sheets({ version: "v4", auth });
    return this.sheetsClient;
  }

  /**
   * Retrieve list of configured team names from Apps Script CONFIG sheet
   */
  async getTeams() {
    if (process.env.GOOGLE_APPS_SCRIPT_URL) {
      const result = await this._postToAppsScript({ action: "getTeams" });
      if (result && result.success && Array.isArray(result.teams) && result.teams.length > 0) {
        return result.teams;
      }
      throw new Error(result?.error?.message || "Failed to retrieve team configuration from Google Sheets");
    }
    return CONFIG.TEAMS;
  }


  /**
   * Append canonical match data to Google Sheets
   * Writes to both team sheets with the same Match ID
   * 
   * @param {Object} rawMatch - Canonical match data object
   */
  async appendMatch(rawMatch) {
    if (!this.isConfigured()) {
      throw new Error("Google Sheets integration not configured. GOOGLE_APPS_SCRIPT_URL missing in environment.");
    }

    const validation = validateMatchData(rawMatch);
    if (!validation.valid) {
      throw new Error(`Invalid match data: ${validation.errors.join("; ")}`);
    }

    const canonicalMatch = sanitizeMatchData(rawMatch);

    if (process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log(`[SHEETS-SERVICE] Posting match ${canonicalMatch.matchId} to Apps Script...`);
      const result = await this._postToAppsScript({
        action: "appendMatch",
        match: canonicalMatch,
      });

      if (!result || result.success === false) {
        const errorMsg = result?.error?.message || "Failed to append match to Google Sheets";
        const errorCode = result?.error?.code || "SHEETS_WRITE_FAILED";
        const err = new Error(errorMsg);
        err.code = errorCode;
        throw err;
      }

      return {
        ok: true,
        success: true,
        matchId: result.matchId || canonicalMatch.matchId,
        updatedTeams: result.updatedTeams || [canonicalMatch.teamA.name, canonicalMatch.teamB.name],
        message: result.message || `Match ${canonicalMatch.matchId} successfully appended to Google Sheets.`,
      };
    }

    // Direct Google Sheets API fallback (if legacy service account credentials are used)
    return this._appendMatchDirect(canonicalMatch);
  }

  async _appendMatchDirect(matchData) {
    const sheets = this._initializeDirectClient();
    const { matchId, matchDate, teamA, teamB } = matchData;
    const date = matchDate || matchData.date;

    const rowA = await this._getNextAvailableRowDirect(teamA.name);
    const rowB = await this._getNextAvailableRowDirect(teamB.name);

    const teamAData = this._formatTeamBlock(matchId, date, teamA.name, teamB.name, teamA.players);
    const teamBData = this._formatTeamBlock(matchId, date, teamB.name, teamA.name, teamB.players);

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: `'${teamA.name}'!A${rowA}`, values: teamAData.values },
          { range: `'${teamB.name}'!A${rowB}`, values: teamBData.values },
        ],
      },
    });

    return {
      ok: true,
      success: true,
      matchId,
      updatedTeams: [teamA.name, teamB.name],
      message: `Match ${matchId} pushed to ${teamA.name} and ${teamB.name}`,
    };
  }

  async _getNextAvailableRowDirect(sheetName) {
    const sheets = this._initializeDirectClient();
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${sheetName}'!A:A`,
      });
      const values = response.data.values || [];
      return Math.max(2, values.length + 1);
    } catch (error) {
      return 2;
    }
  }

  _formatTeamBlock(matchId, date, teamName, opponentName, players) {
    const values = [
      [`MATCH ${matchId}`],
      ["Date:", date],
      ["Opponent:", opponentName],
      [],
      ["PLAYER", "AGENT", "ACS", "K/D/A", "ECON", "FB", "PLT", "DEF"],
    ];

    (players || []).forEach((player) => {
      values.push([
        player.name,
        player.agent,
        player.acs,
        player.kda,
        player.econ,
        player.firstBloods,
        player.plants,
        player.defuses,
      ]);
    });

    values.push([], []);
    return { values };
  }
}

// Global instance
export const googleSheetsService = new GoogleSheetsService();

// Standalone exports for backward compatibility
export function initializeSheetsClient() {
  return googleSheetsService.initialize();
}

export async function pushMatchToSheets(spreadsheetId, matchData) {
  return googleSheetsService.appendMatch(matchData);
}


