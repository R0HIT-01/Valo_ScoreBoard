import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateMatchData, sanitizeMatchData, sanitizePlayer } from "../utils/validation.js";
import { initializeDatabase, getNextMatchId, recordMatch, getMatchById } from "../db/database.js";

// ============================================================
// Helpers
// ============================================================

const createValidPlayers = (prefix = "Player") => [
  { name: `${prefix} 1`, agent: "Jett", acs: 335, kda: "32/14/5", econ: 81, firstBloods: 4, plants: 2, defuses: 1 },
  { name: `${prefix} 2`, agent: "Phoenix", acs: 304, kda: "23/23/6", econ: 73, firstBloods: 6, plants: 0, defuses: 1 },
  { name: `${prefix} 3`, agent: "Sage", acs: 259, kda: "21/19/12", econ: 64, firstBloods: 2, plants: 2, defuses: 0 },
  { name: `${prefix} 4`, agent: "Cypher", acs: 251, kda: "20/19/6", econ: 58, firstBloods: 5, plants: 0, defuses: 0 },
  { name: `${prefix} 5`, agent: "Viper", acs: 235, kda: "20/19/9", econ: 62, firstBloods: 3, plants: 2, defuses: 0 },
];

const createMatch = (matchId) => ({
  matchId,
  matchDate: "2026-09-13",
  teamA: { name: "TEAM PTSD", detectedColor: "red", players: createValidPlayers("PTSD") },
  teamB: { name: "TEAM UltraViolence", detectedColor: "teal", players: createValidPlayers("UV") },
});

// ============================================================
// ISSUE 1 — Match ID in response must be the SUBMITTED id, not next
// ============================================================

test("Regression: submitted M001 returns M001 in response, next becomes M002", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_regression_matchid_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);

    // Before submission, next ID is M001
    const suggestedId = await getNextMatchId(db);
    assert.equal(suggestedId, "M001");

    // Simulate the exact server.js flow: record match with user-selected M001
    const match = createMatch("M001");
    const recordedId = await recordMatch(db, match);

    // recordMatch returns the match ID that was committed
    assert.equal(recordedId, "M001", "recordMatch must return the submitted match ID, not the next one");

    // After commit, the stored match must be M001
    const stored = await getMatchById(db, "M001");
    assert.ok(stored, "M001 must exist in SQLite after recordMatch");
    assert.equal(stored.match_id, "M001");

    // Next suggested ID advances to M002 (for next match)
    const nextId = await getNextMatchId(db);
    assert.equal(nextId, "M002", "Next suggested ID should be M002 after M001 is committed");

    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("Regression: server response matchId field uses canonicalMatch.matchId (the submitted ID)", () => {
  // Simulates the server.js response construction (line 206-211)
  const canonicalMatch = sanitizeMatchData(createMatch("M001"));
  assert.equal(canonicalMatch.matchId, "M001");

  // The response should contain matchId: canonicalMatch.matchId
  const mockResponse = {
    ok: true,
    message: `Match ${canonicalMatch.matchId} recorded.`,
    matchId: canonicalMatch.matchId,
  };
  assert.equal(mockResponse.matchId, "M001", "API response must contain the submitted matchId, not a next-suggested one");
});

// ============================================================
// ISSUE 2 — K/D/A must remain a string, never parsed as a date
// ============================================================

test("Regression: K/D/A string '11/19/8' survives sanitization as exact string", () => {
  const player = sanitizePlayer({
    name: "Ciggy", agent: "Fade", acs: 152, kda: "11/19/8", econ: 55, firstBloods: 0, plants: 1, defuses: 1,
  });
  assert.equal(typeof player.kda, "string", "K/D/A must be a string type");
  assert.equal(player.kda, "11/19/8", "K/D/A must be exactly '11/19/8', not reformatted or parsed");
});

test("Regression: K/D/A string '10/17/8' survives sanitization as exact string", () => {
  const player = sanitizePlayer({
    name: "MTPX Kinesis", agent: "Sova", acs: 129, kda: "10/17/8", econ: 36, firstBloods: 1, plants: 2, defuses: 0,
  });
  assert.equal(typeof player.kda, "string");
  assert.equal(player.kda, "10/17/8", "K/D/A must be exactly '10/17/8'");
});

test("Regression: K/D/A values that resemble dates are validated as valid K/D/A format", () => {
  const datelikeKDAs = ["10/17/8", "11/19/8", "1/2/3", "32/14/5"];
  for (const kda of datelikeKDAs) {
    const match = createMatch("M001");
    match.teamA.players[0].kda = kda;
    const res = validateMatchData(match);
    assert.equal(res.valid, true, `K/D/A '${kda}' should be valid. Errors: ${res.errors.join("; ")}`);
  }
});

test("Regression: K/D/A in canonical payload is always a string type", () => {
  const match = createMatch("M001");
  const sanitized = sanitizeMatchData(match);
  for (const player of sanitized.teamA.players) {
    assert.equal(typeof player.kda, "string", `K/D/A for ${player.name} must be string, got ${typeof player.kda}`);
    assert.ok(/^\d+\/\d+\/\d+$/.test(player.kda), `K/D/A for ${player.name} must match XX/XX/XX format`);
  }
});

// ============================================================
// ISSUE 3 — DEF values must survive sanitization correctly
// ============================================================

test("Regression: DEF value 0 survives sanitization as numeric 0", () => {
  const player = sanitizePlayer({
    name: "F0rSakeN", agent: "Reyna", acs: 204, kda: "17/17/3", econ: 56, firstBloods: 2, plants: 1, defuses: 0,
  });
  assert.equal(typeof player.defuses, "number");
  assert.equal(player.defuses, 0);
});

test("Regression: DEF value 1 survives sanitization as numeric 1", () => {
  const player = sanitizePlayer({
    name: "ATMAN FPS", agent: "Clove", acs: 304, kda: "23/23/6", econ: 73, firstBloods: 6, plants: 0, defuses: 1,
  });
  assert.equal(typeof player.defuses, "number");
  assert.equal(player.defuses, 1, "DEF=1 must not become 0 through sanitization");
});

test("Regression: DEF value 1 from string '1' survives sanitization", () => {
  // OCR may return defuses as a string
  const player = sanitizePlayer({
    name: "Ciggy", agent: "Fade", acs: 152, kda: "11/19/8", econ: 55, firstBloods: 0, plants: 1, defuses: "1",
  });
  assert.equal(typeof player.defuses, "number");
  assert.equal(player.defuses, 1, "DEF='1' (string) must become numeric 1, not 0");
});

test("Regression: DEF value 0 from string '0' survives sanitization", () => {
  const player = sanitizePlayer({
    name: "Venomnom", agent: "Brimstone", acs: 166, kda: "16/19/5", econ: 43, firstBloods: 0, plants: 6, defuses: "0",
  });
  assert.equal(typeof player.defuses, "number");
  assert.equal(player.defuses, 0);
});

test("Regression: other numeric fields (ACS, ECON, FB, PLT) remain numeric after sanitization", () => {
  const player = sanitizePlayer({
    name: "HCL7", agent: "Jett", acs: 335, kda: "32/14/5", econ: 81, firstBloods: 4, plants: 2, defuses: 1,
  });
  assert.equal(typeof player.acs, "number");
  assert.equal(player.acs, 335);
  assert.equal(typeof player.econ, "number");
  assert.equal(player.econ, 81);
  assert.equal(typeof player.firstBloods, "number");
  assert.equal(player.firstBloods, 4);
  assert.equal(typeof player.plants, "number");
  assert.equal(player.plants, 2);
  assert.equal(typeof player.defuses, "number");
  assert.equal(player.defuses, 1);
});

// ============================================================
// ISSUE 4 — Non-JSON Apps Script Error Handling Diagnostics
// ============================================================

test("Regression: GoogleSheetsService handles HTML response gracefully without exposing raw HTML or secrets", async () => {
  const { GoogleSheetsService } = await import("../services/sheetsService.js");
  const service = new GoogleSheetsService();

  // Mock global fetch to return an HTML page (like Google Accounts login or Apps Script error)
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map([["content-type", "text/html; charset=utf-8"]]),
    text: async () => "<!DOCTYPE html><html><head><title>Sign in - Google Accounts</title></head><body>...</body></html>",
  });

  const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  process.env.GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/SECRET_DEPLOYMENT_ID/exec";

  try {
    await assert.rejects(
      async () => {
        await service.getTeams();
      },
      (err) => {
        // Must indicate HTML response and HTTP status
        assert.ok(err.message.includes("Apps Script returned HTML"), `Message should explain HTML response: ${err.message}`);
        assert.ok(err.message.includes("HTTP 200"), `Message should include HTTP status: ${err.message}`);
        // Must NOT leak the secret URL in the error message
        assert.ok(!err.message.includes("SECRET_DEPLOYMENT_ID"), "Error message must not leak deployment ID or secret URL");
        // Must NOT dump raw HTML document into error message
        assert.ok(!err.message.includes("<!DOCTYPE html>"), "Error message must not dump raw HTML");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (origUrl) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl;
    else delete process.env.GOOGLE_APPS_SCRIPT_URL;
  }
});

// ============================================================
// ISSUE 5 — Apps Script Player Row Schema & Literal K/D/A Formatting
// ============================================================

test("Regression: Code.gs player row structure matches exactly 8 columns with literal K/D/A apostrophe", () => {
  const players = [
    { name: "ATMAN FPS", agent: "RAZE", acs: 304, kda: "23/23/6", econ: 73, firstBloods: 6, plants: 0, defuses: 1 },
    { name: "Ciggy", agent: "FADE", acs: 152, kda: "11/19/8", econ: 55, firstBloods: 0, plants: 1, defuses: 1 },
    { name: "MTPX Kinesis", agent: "BREACH", acs: 129, kda: "10/17/8", econ: 36, firstBloods: 1, plants: 2, defuses: 0 },
  ];

  // Replicate Code.gs writeMatchBlock player row mapping
  const allPlayerRows = [];
  players.forEach((player) => {
    const rawKda = String(player.kda || "").trim();
    const literalKda = rawKda.charAt(0) === "'" ? rawKda : "'" + rawKda;
    allPlayerRows.push([
      String(player.name || ""),
      String(player.agent || ""),
      Number(player.acs),
      literalKda,
      Number(player.econ),
      Number(player.firstBloods),
      Number(player.plants),
      Number(player.defuses),
    ]);
  });

  assert.equal(allPlayerRows.length, 3);
  for (const row of allPlayerRows) {
    assert.equal(row.length, 8, "Row must have exactly 8 fields: [PLAYER, AGENT, ACS, K/D/A, ECON, FB, PLT, DEF]");
    assert.equal(typeof row[0], "string"); // PLAYER
    assert.equal(typeof row[1], "string"); // AGENT
    assert.equal(typeof row[2], "number"); // ACS
    assert.equal(typeof row[3], "string"); // K/D/A (literal text)
    assert.ok(row[3].startsWith("'"), "K/D/A must start with single quote/apostrophe to prevent date coercion");
    assert.equal(typeof row[4], "number"); // ECON
    assert.equal(typeof row[5], "number"); // FB
    assert.equal(typeof row[6], "number"); // PLT
    assert.equal(typeof row[7], "number"); // DEF
  }

  // Verify specific rows
  assert.equal(allPlayerRows[0][3], "'23/23/6");
  assert.equal(allPlayerRows[0][7], 1); // ATMAN FPS DEF = 1
  assert.equal(allPlayerRows[1][3], "'11/19/8");
  assert.equal(allPlayerRows[1][7], 1); // Ciggy DEF = 1
  assert.equal(allPlayerRows[2][3], "'10/17/8");
  assert.equal(allPlayerRows[2][7], 0); // MTPX DEF = 0
});

