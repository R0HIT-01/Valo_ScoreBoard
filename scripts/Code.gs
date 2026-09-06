/**
 * VALORANT MATCH ANALYZER — GOOGLE APPS SCRIPT WEB APP
 * 
 * Paste this script into your Google Spreadsheet Apps Script Editor.
 * 
 * Functions:
 * - doPost(e) / doGet(e): API endpoints for Web App
 * - initSpreadsheet(): Idempotent initialization of CONFIG and 8 Team sheets
 * - getTeamsFromConfig(): Returns array of configured team names
 * - appendMatch(canonicalMatch): Preflight validation and atomic appending to team sheets
 */

const DEFAULT_TEAMS = [
  { id: "T001", name: "TEAM PTSD" },
  { id: "T002", name: "TEAM UltraViolence" },
  { id: "T003", name: "TEAM We Mind Esp" },
  { id: "T004", name: "TEAM Redline" },
  { id: "T005", name: "TEAM Hexa" },
  { id: "T006", name: "TEAM JBGD" },
  { id: "T007", name: "TEAM Plastic Gng" },
];

/**
 * Handle HTTP POST requests
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({
        success: false,
        error: { code: "INVALID_REQUEST", message: "Request body is empty" },
      });
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || "appendMatch";

    if (action === "init") {
      const result = initSpreadsheet();
      return jsonResponse(result);
    }

    if (action === "getTeams") {
      const teams = getTeamsFromConfig();
      return jsonResponse({ success: true, teams });
    }

    if (action === "appendMatch") {
      const match = payload.match || payload;
      const result = appendMatch(match);
      return jsonResponse(result);
    }

    return jsonResponse({
      success: false,
      error: { code: "UNKNOWN_ACTION", message: "Action '" + action + "' is not supported" },
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: { code: "SERVER_ERROR", message: err.message || String(err) },
    });
  }
}

/**
 * Handle HTTP GET requests
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "health";

    if (action === "init") {
      const result = initSpreadsheet();
      return jsonResponse(result);
    }

    if (action === "getTeams") {
      const teams = getTeamsFromConfig();
      return jsonResponse({ success: true, teams });
    }

    return jsonResponse({
      success: true,
      status: "online",
      message: "Valorant Match Analyzer Apps Script Web App is active",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: { code: "SERVER_ERROR", message: err.message || String(err) },
    });
  }
}

/**
 * Helper to build JSON responses
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Idempotent initialization of spreadsheet structure
 * Creates/repairs CONFIG tab and 8 Team tabs without overwriting existing match data.
 */
function initSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const createdSheets = [];
  const existingSheets = [];

  // 1. Initialize CONFIG sheet
  let configSheet = ss.getSheetByName("CONFIG");
  if (!configSheet) {
    configSheet = ss.insertSheet("CONFIG");
    configSheet.appendRow(["Team ID", "Team Name"]);
    const headerRange = configSheet.getRange(1, 1, 1, 2);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1F2937");
    headerRange.setFontColor("#FFFFFF");

    DEFAULT_TEAMS.forEach(function (team) {
      configSheet.appendRow([team.id, team.name]);
    });
    configSheet.autoResizeColumns(1, 2);
    createdSheets.push("CONFIG");
  } else {
    existingSheets.push("CONFIG");
  }

  // 2. Initialize Team sheets
  DEFAULT_TEAMS.forEach(function (team) {
    let sheet = ss.getSheetByName(team.name);
    if (!sheet) {
      sheet = ss.insertSheet(team.name);
      
      // Add sheet title block
      const titleCell = sheet.getRange("A1");
      titleCell.setValue(team.name.toUpperCase() + " — MATCH HISTORY");
      titleCell.setFontWeight("bold");
      titleCell.setFontSize(14);
      titleCell.setFontColor("#0F1923");

      sheet.appendRow([""]); // Spacing row 2
      createdSheets.push(team.name);
    } else {
      existingSheets.push(team.name);
    }
  });

  return {
    success: true,
    message: "Spreadsheet initialization complete",
    createdSheets: createdSheets,
    existingSheets: existingSheets,
  };
}

/**
 * Read team list from CONFIG sheet
 */
function getTeamsFromConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("CONFIG");

  if (!configSheet) {
    return DEFAULT_TEAMS.map(function (t) { return t.name; });
  }

  const values = configSheet.getDataRange().getValues();
  const teams = [];

  // Skip row 0 (header)
  for (let i = 1; i < values.length; i++) {
    const teamName = values[i][1];
    if (teamName && String(teamName).trim() !== "") {
      teams.push(String(teamName).trim());
    }
  }

  return teams.length > 0 ? teams : DEFAULT_TEAMS.map(function (t) { return t.name; });
}

/**
 * Append canonical match data to Google Sheets with atomic preflight validation
 */
function appendMatch(match) {
  // Preflight Validation 1: Structural existence
  if (!match || typeof match !== "object") {
    return {
      success: false,
      error: { code: "INVALID_MATCH_DATA", message: "Match object is null or invalid" },
    };
  }

  const matchId = match.matchId;
  const matchDate = match.matchDate || match.date;
  const teamA = match.teamA;
  const teamB = match.teamB;

  if (!matchId || typeof matchId !== "string") {
    return {
      success: false,
      error: { code: "INVALID_MATCH_ID", message: "Match ID is missing or invalid" },
    };
  }

  if (!matchDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(matchDate).trim())) {
    return {
      success: false,
      error: { code: "INVALID_MATCH_DATE", message: "Match date must be in YYYY-MM-DD format" },
    };
  }

  // Preflight Validation 2: Team existence and distinctness
  if (!teamA || !teamB || !teamA.name || !teamB.name) {
    return {
      success: false,
      error: { code: "INVALID_TEAMS", message: "Both teamA.name and teamB.name are required" },
    };
  }

  if (teamA.name === teamB.name) {
    return {
      success: false,
      error: { code: "DUPLICATE_TEAMS", message: "Team A and Team B must be different teams" },
    };
  }

  // Preflight Validation 3: 5 Players per team
  if (!teamA.players || teamA.players.length !== 5) {
    return {
      success: false,
      error: { code: "INVALID_PLAYER_COUNT", message: "Team A must have exactly 5 players" },
    };
  }

  if (!teamB.players || teamB.players.length !== 5) {
    return {
      success: false,
      error: { code: "INVALID_PLAYER_COUNT", message: "Team B must have exactly 5 players" },
    };
  }

  // Preflight Validation 4: Player fields
  const validatePlayerGroup = function (players, teamLabel) {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.name || String(p.name).trim() === "") {
        return teamLabel + " Player " + (i + 1) + ": Name is required";
      }
      if (!p.agent || String(p.agent).trim() === "") {
        return teamLabel + " Player " + (i + 1) + ": Agent is required";
      }
      if (!/^\d+\/\d+\/\d+$/.test(String(p.kda || "").trim())) {
        return teamLabel + " Player " + (i + 1) + ": K/D/A format must be XX/XX/XX";
      }
    }
    return null;
  };

  const errA = validatePlayerGroup(teamA.players, "Team A");
  if (errA) return { success: false, error: { code: "MALFORMED_PLAYER", message: errA } };

  const errB = validatePlayerGroup(teamB.players, "Team B");
  if (errB) return { success: false, error: { code: "MALFORMED_PLAYER", message: errB } };

  // Preflight Validation 5: Check destination sheets exist
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetA = ss.getSheetByName(teamA.name);
  const sheetB = ss.getSheetByName(teamB.name);

  if (!sheetA) {
    return {
      success: false,
      error: { code: "MISSING_TEAM_SHEET", message: "Destination sheet for '" + teamA.name + "' does not exist." },
    };
  }

  if (!sheetB) {
    return {
      success: false,
      error: { code: "MISSING_TEAM_SHEET", message: "Destination sheet for '" + teamB.name + "' does not exist." },
    };
  }

  // Preflight Validation 6: Duplicate Match ID Check
  if (checkDuplicateMatchId(sheetA, matchId)) {
    return {
      success: false,
      error: { code: "DUPLICATE_MATCH_ID", message: "Match " + matchId + " already exists in sheet '" + teamA.name + "'." },
    };
  }

  if (checkDuplicateMatchId(sheetB, matchId)) {
    return {
      success: false,
      error: { code: "DUPLICATE_MATCH_ID", message: "Match " + matchId + " already exists in sheet '" + teamB.name + "'." },
    };
  }

  // ALL PREFLIGHT CHECKS PASSED — PERFORM WRITES
  writeMatchBlock(sheetA, matchId, matchDate, teamA.name, teamB.name, teamA.players, "#BD3944");
  writeMatchBlock(sheetB, matchId, matchDate, teamB.name, teamA.name, teamB.players, "#009B8D");

  return {
    success: true,
    matchId: matchId,
    updatedTeams: [teamA.name, teamB.name],
    message: "Match " + matchId + " written to " + teamA.name + " and " + teamB.name,
  };
}

/**
 * Check if a Match ID already exists in a sheet's column A
 */
function checkDuplicateMatchId(sheet, matchId) {
  const data = sheet.getColumnValues ? sheet.getColumnValues(1) : sheet.getRange("A:A").getValues();
  const searchStr = "MATCH " + matchId;

  for (let i = 0; i < data.length; i++) {
    const val = String(data[i][0] || "").trim();
    if (val === searchStr || val === matchId) {
      return true;
    }
  }
  return false;
}

/**
 * Append formatted match block to a team sheet
 */
function writeMatchBlock(sheet, matchId, date, teamName, opponentName, players, themeColor) {
  const lastRow = Math.max(1, sheet.getLastRow());
  const startRow = lastRow > 1 ? lastRow + 2 : 3; // Leave 2 blank rows spacing

  // 1. Match Header Row
  const headerCell = sheet.getRange(startRow, 1);
  headerCell.setValue("MATCH " + matchId);
  headerCell.setFontWeight("bold");
  headerCell.setFontSize(12);
  headerCell.setBackground(themeColor);
  headerCell.setFontColor("#FFFFFF");

  // Merge match header across 8 columns
  sheet.getRange(startRow, 1, 1, 8).merge().setBackground(themeColor).setFontColor("#FFFFFF").setFontWeight("bold");

  // 2. Metadata Rows
  sheet.getRange(startRow + 1, 1).setValue("Date:").setFontWeight("bold");
  sheet.getRange(startRow + 1, 2).setValue(date);
  sheet.getRange(startRow + 2, 1).setValue("Opponent:").setFontWeight("bold");
  sheet.getRange(startRow + 2, 2).setValue(opponentName);

  // 3. Column Header Row
  const headers = ["PLAYER", "AGENT", "ACS", "K/D/A", "ECON", "FB", "PLT", "DEF"];
  const colHeaderRow = startRow + 4;
  
  for (let col = 0; col < headers.length; col++) {
    const cell = sheet.getRange(colHeaderRow, col + 1);
    cell.setValue(headers[col]);
    cell.setFontWeight("bold");
    cell.setBackground("#1F2937");
    cell.setFontColor("#FFFFFF");
    cell.setHorizontalAlignment("center");
  }

  // 4. Player Rows
  players.forEach(function (player, idx) {
    const r = colHeaderRow + 1 + idx;
    const rowValues = [
      player.name,
      player.agent,
      Number(player.acs),
      player.kda,
      Number(player.econ),
      Number(player.firstBloods),
      Number(player.plants),
      Number(player.defuses),
    ];

    for (let c = 0; c < rowValues.length; c++) {
      const cell = sheet.getRange(r, c + 1);
      cell.setValue(rowValues[c]);
      if (c >= 2 && c !== 3) {
        cell.setHorizontalAlignment("center");
      }
    }

    // Zebra striping
    if (idx % 2 === 1) {
      sheet.getRange(r, 1, 1, 8).setBackground("#F9FAFB");
    }
  });

  // 5. Borders around match block table
  const tableRange = sheet.getRange(colHeaderRow, 1, 6, 8);
  tableRange.setBorder(true, true, true, true, true, true, "#E5E7EB", SpreadsheetApp.BorderStyle.SOLID);
}
