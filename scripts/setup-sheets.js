#!/usr/bin/env node

/**
 * Google Sheets Setup Helper
 * This script helps create and format the Google Sheets for the Valorant Analyzer
 * 
 * Prerequisites:
 * - Credentials must be in .env (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY, etc)
 * - Google Sheets API must be enabled
 * - Service account must have Editor access to the spreadsheet
 * 
 * Usage: node scripts/setup-sheets.js
 */

import dotenv from "dotenv";
import { google } from "googleapis";
import readline from "readline";

dotenv.config();

const TEAM_NAMES = [
  "TEAM PTSD",
  "TEAM UltraViolence",
  "TEAM We Mind Esp",
  "TEAM Redline",
  "TEAM Hexa",
  "TEAM JBGD",
  "TEAM Plastic Gng",
];

const COLUMN_HEADERS = ["PLAYER", "AGENT", "ACS", "K/D/A", "ECON", "FB", "PLT", "DEF"];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

async function getCredentials() {
  const credentials = {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || "key-id",
    private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID || "client-id",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  };

  // Verify all required fields
  const required = ["project_id", "client_email", "private_key"];
  const missing = required.filter(field => !credentials[field]);

  if (missing.length > 0) {
    throw new Error(`Missing credentials in .env: ${missing.join(", ")}`);
  }

  return credentials;
}

async function initializeSheetsAPI() {
  const credentials = await getCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function getExistingSheets(sheetsAPI, spreadsheetId) {
  const response = await sheetsAPI.spreadsheets.get({ spreadsheetId });
  return response.data.sheets.map(s => s.properties.title);
}

async function createSheet(sheetsAPI, spreadsheetId, sheetName) {
  const response = await sheetsAPI.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName,
              gridProperties: {
                rowCount: 1000,
                columnCount: 8,
              },
            },
          },
        },
      ],
    },
  });

  return response.data.replies[0].addSheet.properties.sheetId;
}

async function formatSheet(sheetsAPI, spreadsheetId, sheetName, sheetId) {
  // Add header row
  await sheetsAPI.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A1:H1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [COLUMN_HEADERS],
    },
  });

  // Format header row
  await sheetsAPI.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: {
                  red: 0.2,
                  green: 0.2,
                  blue: 0.2,
                },
                textFormat: {
                  bold: true,
                  foregroundColor: {
                    red: 1,
                    green: 1,
                    blue: 1,
                  },
                },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat",
          },
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId: sheetId,
              gridProperties: {
                frozenRowCount: 1,
              },
            },
            fields: "gridProperties",
          },
        },
      ],
    },
  });
}

async function setupSheets() {
  console.log(`
╔════════════════════════════════════════╗
║  🎮 GOOGLE SHEETS SETUP HELPER         ║
║     Valorant Match Analyzer            ║
╚════════════════════════════════════════╝
  `);

  // Validate configuration
  if (!process.env.GOOGLE_SPREADSHEET_ID) {
    console.error("❌ Error: GOOGLE_SPREADSHEET_ID is not set in .env");
    process.exit(1);
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    console.error("❌ Error: GOOGLE_SERVICE_ACCOUNT_EMAIL is not set in .env");
    process.exit(1);
  }

  try {
    console.log("\n📋 Initializing Google Sheets API...");
    const sheetsAPI = await initializeSheetsAPI();
    console.log("✓ Connected to Google Sheets API");

    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    console.log("\n📊 Checking existing sheets...");
    const existingSheets = await getExistingSheets(sheetsAPI, spreadsheetId);
    console.log(`✓ Found ${existingSheets.length} existing sheets`);

    if (existingSheets.length > 0) {
      console.log("  Sheets:", existingSheets.join(", "));
    }

    // Create missing team sheets
    console.log("\n⚙️  Creating team sheets...");
    for (const teamName of TEAM_NAMES) {
      if (existingSheets.includes(teamName)) {
        console.log(`  ✓ ${teamName} (already exists)`);
      } else {
        console.log(`  🔄 Creating ${teamName}...`);
        const sheetId = await createSheet(sheetsAPI, spreadsheetId, teamName);
        await formatSheet(sheetsAPI, spreadsheetId, teamName, sheetId);
        console.log(`  ✓ ${teamName} (created and formatted)`);
      }
    }

    console.log(`
✅ Google Sheets setup complete!

Spreadsheet: ${spreadsheetId}
Service Account: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}

Created/Verified sheets:
${TEAM_NAMES.map(t => `  • ${t}`).join("\n")}

Next steps:
1. Open your spreadsheet in Google Sheets
2. Verify all team tabs exist with headers
3. Start the backend: npm start
4. Upload a scoreboard screenshot

For troubleshooting, see: SETUP_GUIDE.md
    `);

    rl.close();
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error("\nTroubleshooting:");
    console.error("• Check .env has all required Google credentials");
    console.error("• Verify service account has Editor access to spreadsheet");
    console.error("• Ensure Google Sheets API is enabled in Google Cloud Console");
    console.error("• Check the spreadsheet ID is correct");
    rl.close();
    process.exit(1);
  }
}

setupSheets();
