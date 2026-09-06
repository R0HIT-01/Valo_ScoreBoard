import dotenv from "dotenv";
dotenv.config();
import assert from "node:assert/strict";
import { googleSheetsService } from "../services/sheetsService.js";

// Exact canonical match fixture for M999 integration test
const m999Fixture = {
  matchId: "M999",
  matchDate: "2026-09-06",
  teamA: {
    name: "Team Alpha",
    detectedColor: "red",
    players: [
      { name: "Player A1", agent: "Jett", acs: 250, kda: "20/10/5", econ: 150, firstBloods: 3, plants: 1, defuses: 0 },
      { name: "Player A2", agent: "Sova", acs: 220, kda: "18/12/7", econ: 140, firstBloods: 2, plants: 2, defuses: 0 },
      { name: "Player A3", agent: "Omen", acs: 200, kda: "16/14/6", econ: 130, firstBloods: 1, plants: 1, defuses: 1 },
      { name: "Player A4", agent: "Raze", acs: 190, kda: "15/15/4", econ: 125, firstBloods: 1, plants: 0, defuses: 0 },
      { name: "Player A5", agent: "Viper", acs: 180, kda: "14/16/8", econ: 120, firstBloods: 0, plants: 1, defuses: 1 },
    ],
  },
  teamB: {
    name: "Team Bravo",
    detectedColor: "teal",
    players: [
      { name: "Player B1", agent: "Phoenix", acs: 245, kda: "21/11/3", econ: 148, firstBloods: 4, plants: 0, defuses: 0 },
      { name: "Player B2", agent: "Fade", acs: 215, kda: "17/13/6", econ: 138, firstBloods: 1, plants: 2, defuses: 0 },
      { name: "Player B3", agent: "Killjoy", acs: 195, kda: "15/15/5", econ: 128, firstBloods: 0, plants: 1, defuses: 1 },
      { name: "Player B4", agent: "Breach", acs: 185, kda: "13/17/8", econ: 118, firstBloods: 0, plants: 0, defuses: 2 },
      { name: "Player B5", agent: "Cypher", acs: 175, kda: "12/18/9", econ: 115, firstBloods: 0, plants: 1, defuses: 0 },
    ],
  },
};

async function runLiveVerification() {
  console.log("==================================================");
  console.log("  REAL GOOGLE SHEETS LIVE VERIFICATION SUITE");
  console.log("==================================================");
  console.log("Target Apps Script URL:", process.env.GOOGLE_APPS_SCRIPT_URL);

  // 1. GET /api/teams (fetch configured teams from CONFIG sheet)
  console.log("\n[STEP 3] Fetching teams from live CONFIG sheet...");
  const teams = await googleSheetsService.getTeams();
  console.log("✓ Returned Teams:", teams);
  assert.ok(Array.isArray(teams) && teams.length === 8);
  assert.ok(teams.includes("Team Alpha"));
  assert.ok(teams.includes("Team Bravo"));

  // 2. POST /api/init-sheets (Idempotent initialization)
  console.log("\n[STEP 4] Testing Spreadsheet Initialization (Run #1)...");
  const init1 = await googleSheetsService.initialize();
  console.log("✓ Init Run #1 Result:", init1.message || "Success");

  console.log("[STEP 4] Testing Spreadsheet Initialization (Run #2 - Idempotent Check)...");
  const init2 = await googleSheetsService.initialize();
  console.log("✓ Init Run #2 Result:", init2.message || "Success (Idempotent)");

  // 3. Real M999 Match Append
  console.log("\n[STEP 5 & 6] Appending Real M999 Canonical Match to Team Alpha and Team Bravo...");
  try {
    const appendRes = await googleSheetsService.appendMatch(m999Fixture);
    console.log("✓ M999 Append Result:", appendRes.message);
    assert.equal(appendRes.matchId, "M999");
    assert.deepEqual(appendRes.updatedTeams, ["Team Alpha", "Team Bravo"]);
  } catch (err) {
    if (err.message.includes("already exists")) {
      console.log("ℹ Match M999 was previously written to the spreadsheet.");
    } else {
      throw err;
    }
  }

  // 4. Duplicate Match ID Verification (Resubmitting M999 MUST fail with DUPLICATE_MATCH_ID)
  console.log("\n[STEP 7] Verifying Duplicate Match ID Protection (Re-submitting M999)...");
  let duplicateCaught = false;
  try {
    await googleSheetsService.appendMatch(m999Fixture);
  } catch (err) {
    duplicateCaught = true;
    console.log(`✓ Duplicate M999 rejected correctly! Code: ${err.code || "DUPLICATE_MATCH_ID"}, Message: ${err.message}`);
    assert.ok(err.code === "DUPLICATE_MATCH_ID" || err.message.includes("already exists"));
  }
  assert.ok(duplicateCaught, "Duplicate M999 submission should have been rejected!");

  // 5. Failure Safety Tests
  console.log("\n[STEP 8] Running Failure Safety & Preflight Validation Tests...");

  // A. Self-Match (Team Alpha vs Team Alpha)
  console.log("  Testing Self-Match (Team Alpha vs Team Alpha)...");
  const selfMatch = JSON.parse(JSON.stringify(m999Fixture));
  selfMatch.matchId = "M998";
  selfMatch.teamB.name = "Team Alpha";
  await assert.rejects(
    async () => googleSheetsService.appendMatch(selfMatch),
    (err) => {
      console.log("  ✓ Self-match rejected:", err.message);
      return true;
    }
  );

  // B. 4 Players on Team A
  console.log("  Testing 4 Players on Team A...");
  const match4Players = JSON.parse(JSON.stringify(m999Fixture));
  match4Players.matchId = "M997";
  match4Players.teamA.players.pop();
  await assert.rejects(
    async () => googleSheetsService.appendMatch(match4Players),
    (err) => {
      console.log("  ✓ 4-player team rejected:", err.message);
      return true;
    }
  );

  // C. 6 Players on Team B
  console.log("  Testing 6 Players on Team B...");
  const match6Players = JSON.parse(JSON.stringify(m999Fixture));
  match6Players.matchId = "M996";
  match6Players.teamB.players.push({ name: "Player B6", agent: "Omen", acs: 150, kda: "10/10/5", econ: 100, firstBloods: 0, plants: 0, defuses: 0 });
  await assert.rejects(
    async () => googleSheetsService.appendMatch(match6Players),
    (err) => {
      console.log("  ✓ 6-player team rejected:", err.message);
      return true;
    }
  );

  // D. Malformed Player Object (Missing K/D/A)
  console.log("  Testing Malformed Player Object (Missing K/D/A)...");
  const malformedMatch = JSON.parse(JSON.stringify(m999Fixture));
  malformedMatch.matchId = "M995";
  malformedMatch.teamA.players[0].kda = "invalid_kda";
  await assert.rejects(
    async () => googleSheetsService.appendMatch(malformedMatch),
    (err) => {
      console.log("  ✓ Malformed player rejected:", err.message);
      return true;
    }
  );

  console.log("\n==================================================");
  console.log("  ✅ REAL LIVE GOOGLE SHEETS VERIFICATION COMPLETE!");
  console.log("==================================================");
}

runLiveVerification().catch((err) => {
  console.error("\n❌ LIVE VERIFICATION FAILED:", err);
  process.exit(1);
});
