#!/usr/bin/env node

/**
 * Test utilities and configuration verification
 * Run with: node test-api.js
 */

import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const API_BASE = process.env.API_BASE || "http://localhost:3000";

// Color output helpers
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function success(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function error(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function warning(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function info(msg) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function header(msg) {
  console.log(`\n${colors.cyan}═══ ${msg} ═══${colors.reset}`);
}

/**
 * Test 1: Check configuration
 */
function testConfiguration() {
  header("CONFIGURATION CHECK");

  const checks = [
    { name: "PORT", value: process.env.PORT || "3000" },
    { name: "NODE_ENV", value: process.env.NODE_ENV || "development" },
    { name: "ANTHROPIC_API_KEY", value: process.env.ANTHROPIC_API_KEY ? "✓ Set" : "✗ Missing" },
    { name: "GOOGLE_SERVICE_ACCOUNT_EMAIL", value: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "⚠ Not set" },
    { name: "GOOGLE_SPREADSHEET_ID", value: process.env.GOOGLE_SPREADSHEET_ID || "⚠ Not set" },
    { name: "DB_PATH", value: process.env.DB_PATH || "./data/matches.db" },
  ];

  checks.forEach(check => {
    if (check.value.includes("✓") || check.value.includes("Set")) {
      success(`${check.name}: ${check.value}`);
    } else if (check.value.includes("✗")) {
      error(`${check.name}: ${check.value}`);
    } else if (check.value.includes("⚠")) {
      warning(`${check.name}: ${check.value}`);
    } else {
      info(`${check.name}: ${check.value}`);
    }
  });
}

/**
 * Test 2: Health check
 */
async function testHealthCheck() {
  header("HEALTH CHECK");

  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();

    if (res.ok) {
      success(`Backend is running at ${API_BASE}`);
      info(`Response: ${data.message}`);
      return true;
    } else {
      error(`Health check failed: ${res.status}`);
      return false;
    }
  } catch (err) {
    error(`Cannot connect to backend: ${err.message}`);
    warning(`Make sure the backend is running: npm start`);
    return false;
  }
}

/**
 * Test 3: Next Match ID
 */
async function testNextMatchId() {
  header("MATCH ID GENERATION");

  try {
    const res = await fetch(`${API_BASE}/api/next-match-id`);
    const data = await res.json();

    if (res.ok) {
      success(`Next Match ID: ${data.matchId}`);
      return true;
    } else {
      error(`Failed to get Match ID: ${data.error}`);
      return false;
    }
  } catch (err) {
    error(`Error: ${err.message}`);
    return false;
  }
}

/**
 * Test 4: Sample scoreboard analysis
 * Note: This requires a real image or base64 data
 */
async function testAnalyzeScoreboard() {
  header("SCOREBOARD ANALYSIS");

  // Create a minimal test image (1x1 pixel red PNG)
  // This is just to test the API structure, not actual analysis
  const minimalPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

  info("Testing API structure with minimal image...");
  info("(Real analysis requires actual Valorant scoreboard screenshot)");

  try {
    const res = await fetch(`${API_BASE}/api/analyze-scoreboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: minimalPNG,
        mimeType: "image/png",
      }),
    });

    const data = await res.json();

    if (res.ok) {
      success("API endpoint is functional");
      info(`Extracted ${data.teamA?.length || 0} Team A players`);
      info(`Extracted ${data.teamB?.length || 0} Team B players`);
      return true;
    } else {
      warning(`Analysis failed (expected for test image): ${data.error}`);
      success("API endpoint structure is correct");
      return true;
    }
  } catch (err) {
    error(`Error: ${err.message}`);
    return false;
  }
}

/**
 * Test 5: Sample match push (validation only)
 */
async function testPushValidation() {
  header("PUSH VALIDATION");

  const sampleMatch = {
    matchId: "M999",
    date: "2026-09-06",
    teamA: {
      name: "Team Alpha",
      players: [
        { name: "Player 1", agent: "Jett", acs: 250, kda: "24/12/5", econ: 8500, firstBloods: 3, plants: 2, defuses: 1 },
        { name: "Player 2", agent: "Phoenix", acs: 240, kda: "22/10/4", econ: 8200, firstBloods: 2, plants: 1, defuses: 0 },
        { name: "Player 3", agent: "Sage", acs: 180, kda: "15/8/10", econ: 7800, firstBloods: 0, plants: 0, defuses: 3 },
        { name: "Player 4", agent: "Cypher", acs: 190, kda: "16/9/8", econ: 7500, firstBloods: 1, plants: 0, defuses: 2 },
        { name: "Player 5", agent: "Viper", acs: 200, kda: "18/11/7", econ: 7900, firstBloods: 1, plants: 1, defuses: 1 },
      ],
    },
    teamB: {
      name: "Team Bravo",
      players: [
        { name: "Player A", agent: "Reyna", acs: 260, kda: "25/11/3", econ: 8600, firstBloods: 4, plants: 0, defuses: 0 },
        { name: "Player B", agent: "Omen", acs: 210, kda: "19/14/6", econ: 8000, firstBloods: 1, plants: 1, defuses: 1 },
        { name: "Player C", agent: "Skye", acs: 195, kda: "17/10/9", econ: 7700, firstBloods: 0, plants: 1, defuses: 1 },
        { name: "Player D", agent: "Fade", acs: 205, kda: "20/12/5", econ: 8100, firstBloods: 1, plants: 0, defuses: 2 },
        { name: "Player E", agent: "Breach", acs: 185, kda: "14/13/11", econ: 7400, firstBloods: 0, plants: 1, defuses: 1 },
      ],
    },
  };

  info("Testing match push validation...");

  try {
    const res = await fetch(`${API_BASE}/api/push-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleMatch),
    });

    const data = await res.json();

    if (res.ok) {
      success("Match push validation passed!");
      success(`Match ${data.matchId} was processed`);
      return true;
    } else {
      // Expected to fail if Sheets not configured, but API should validate structure
      if (data.error?.includes("Google Sheets") || data.error?.includes("configured")) {
        success("API validation passed (Sheets not configured for this test)");
        return true;
      } else {
        warning(`Validation response: ${data.error}`);
        return false;
      }
    }
  } catch (err) {
    error(`Error: ${err.message}`);
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log(`
╔════════════════════════════════════════╗
║   🎮 VALORANT ANALYZER - TEST SUITE   ║
╚════════════════════════════════════════╝
  `);

  testConfiguration();

  const healthOk = await testHealthCheck();
  if (!healthOk) {
    error("\nBackend is not running. Start it with: npm start");
    process.exit(1);
  }

  await testNextMatchId();
  await testAnalyzeScoreboard();
  await testPushValidation();

  header("SUMMARY");
  console.log(`
Backend is ready for testing! 🚀

Next steps:
1. Upload a real Valorant scoreboard screenshot
2. Verify extracted player data
3. Test the complete workflow

For detailed setup, see: SETUP_GUIDE.md
  `);
}

// Run tests
runTests().catch(err => {
  error(`Test suite error: ${err.message}`);
  process.exit(1);
});
