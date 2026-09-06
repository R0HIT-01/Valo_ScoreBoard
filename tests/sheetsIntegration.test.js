import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import { GoogleSheetsService, googleSheetsService } from "../services/sheetsService.js";
import { CONFIG } from "../utils/validation.js";


// Helper to construct a valid canonical match
const createTestMatch = (matchId = "M999", date = "2026-09-06") => ({
  matchId,
  matchDate: date,
  teamA: {
    name: "TEAM PTSD",
    detectedColor: "red",
    players: [
      { name: "P1", agent: "Jett", acs: 250, kda: "20/10/5", econ: 8000, firstBloods: 3, plants: 1, defuses: 0 },
      { name: "P2", agent: "Phoenix", acs: 210, kda: "18/12/4", econ: 7500, firstBloods: 1, plants: 0, defuses: 1 },
      { name: "P3", agent: "Sage", acs: 170, kda: "12/8/10", econ: 7000, firstBloods: 0, plants: 0, defuses: 2 },
      { name: "P4", agent: "Cypher", acs: 180, kda: "15/9/7", econ: 7200, firstBloods: 1, plants: 1, defuses: 1 },
      { name: "P5", agent: "Viper", acs: 195, kda: "16/11/6", econ: 7400, firstBloods: 1, plants: 1, defuses: 0 },
    ],
  },
  teamB: {
    name: "TEAM UltraViolence",
    detectedColor: "teal",
    players: [
      { name: "B1", agent: "Reyna", acs: 270, kda: "22/11/3", econ: 8500, firstBloods: 4, plants: 0, defuses: 0 },
      { name: "B2", agent: "Omen", acs: 200, kda: "17/13/8", econ: 7600, firstBloods: 1, plants: 1, defuses: 1 },
      { name: "B3", agent: "Skye", acs: 190, kda: "15/10/9", econ: 7300, firstBloods: 0, plants: 1, defuses: 1 },
      { name: "B4", agent: "Fade", acs: 205, kda: "19/12/5", econ: 7900, firstBloods: 1, plants: 0, defuses: 2 },
      { name: "B5", agent: "Breach", acs: 175, kda: "13/14/10", econ: 7100, firstBloods: 0, plants: 1, defuses: 1 },
    ],
  },
});

// ==================================================
// UNIT TESTS (Run offline / without live credentials)
// ==================================================

test("GoogleSheetsService Unit Test - Unconfigured Graceful Failure", async () => {
  const service = new GoogleSheetsService();
  // Clear env vars for isolated test
  const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  const origId = process.env.GOOGLE_SPREADSHEET_ID;
  delete process.env.GOOGLE_APPS_SCRIPT_URL;
  delete process.env.GOOGLE_SPREADSHEET_ID;

  assert.equal(service.isConfigured(), false);

  await assert.rejects(
    async () => {
      await service.appendMatch(createTestMatch());
    },
    (err) => {
      assert.ok(err.message.includes("not configured"));
      return true;
    }
  );

  // Restore env vars
  if (origUrl) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl;
  if (origId) process.env.GOOGLE_SPREADSHEET_ID = origId;
});

test("GoogleSheetsService Unit Test - Fallback Team List", async () => {
  const service = new GoogleSheetsService();
  const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  delete process.env.GOOGLE_APPS_SCRIPT_URL;

  const teams = await service.getTeams();
  assert.deepEqual(teams, CONFIG.TEAMS);

  if (origUrl) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl;
});

test("GoogleSheetsService Unit Test - Reject Invalid Canonical Match Payload", async () => {
  const service = new GoogleSheetsService();
  // Set dummy URL to test payload validation before network call
  const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  process.env.GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/test/exec";

  const invalidMatch = createTestMatch();
  invalidMatch.teamA.players.pop(); // Only 4 players

  await assert.rejects(
    async () => {
      await service.appendMatch(invalidMatch);
    },
    (err) => {
      assert.ok(err.message.includes("must have exactly 5 players"));
      return true;
    }
  );

  if (origUrl) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl;
  else delete process.env.GOOGLE_APPS_SCRIPT_URL;
});


test("GoogleSheetsService Unit Test - Unreachable Apps Script Throws Error", async () => {
  const service = new GoogleSheetsService();
  const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  // Set invalid unreachable URL
  process.env.GOOGLE_APPS_SCRIPT_URL = "http://localhost:59999/unreachable";

  await assert.rejects(
    async () => {
      await service.getTeams();
    },
    (err) => {
      assert.ok(err.message.includes("fetch failed") || err.message.includes("unreachable") || err.message.includes("ECONNREFUSED"));
      return true;
    }
  );

  if (origUrl) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl;
  else delete process.env.GOOGLE_APPS_SCRIPT_URL;
});

test("GoogleSheetsService Unit Test - Fallback Team List contains 7 Real Teams", async () => {
  const service = new GoogleSheetsService();
  const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  delete process.env.GOOGLE_APPS_SCRIPT_URL;

  const teams = await service.getTeams();
  assert.equal(teams.length, 7);
  assert.deepEqual(teams, [
    "TEAM PTSD",
    "TEAM UltraViolence",
    "TEAM We Mind Esp",
    "TEAM Redline",
    "TEAM Hexa",
    "TEAM JBGD",
    "TEAM Plastic Gng",
  ]);

  if (origUrl) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl;
});

// ==================================================
// LIVE INTEGRATION TESTS (Run only when process.env.RUN_LIVE_TESTS is true)
// ==================================================

if (process.env.RUN_LIVE_TESTS === "true" && process.env.GOOGLE_APPS_SCRIPT_URL) {
  test("GoogleSheetsService Live Test - Initialize Spreadsheet", async () => {
    console.log("[LIVE-TEST] Testing Apps Script init endpoint...");
    const result = await googleSheetsService.initialize();
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.createdSheets) || Array.isArray(result.existingSheets));
  });

  test("GoogleSheetsService Live Test - Fetch Teams from CONFIG Sheet", async () => {
    console.log("[LIVE-TEST] Testing Apps Script getTeams endpoint...");
    const teams = await googleSheetsService.getTeams();
    assert.ok(Array.isArray(teams));
    assert.ok(teams.includes("TEAM PTSD"));
    assert.ok(teams.includes("TEAM UltraViolence"));
  });

  test("GoogleSheetsService Live Test - Append Match and Duplicate Prevention", async () => {
    const testMatchId = `M${Date.now().toString().slice(-4)}`;
    console.log(`[LIVE-TEST] Testing Apps Script appendMatch with match ID ${testMatchId}...`);

    const match = createTestMatch(testMatchId);
    
    // 1. First append should succeed
    const res1 = await googleSheetsService.appendMatch(match);
    assert.equal(res1.ok, true);
    assert.equal(res1.matchId, testMatchId);

    // 2. Duplicate append should fail cleanly with DUPLICATE_MATCH_ID error
    await assert.rejects(
      async () => {
        await googleSheetsService.appendMatch(match);
      },
      (err) => {
        assert.ok(err.code === "DUPLICATE_MATCH_ID" || err.message.includes("already exists"));
        return true;
      }
    );
  });
} else {
  test("GoogleSheetsService Live Test - (Skipped: RUN_LIVE_TESTS not enabled)", () => {
    console.log("ℹ Skipping live Google Sheets network tests against old spreadsheet. Set GOOGLE_APPS_SCRIPT_URL to new spreadsheet Web App to enable.");
  });
}
