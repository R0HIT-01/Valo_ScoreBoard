import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validateMatchData,
  validateTeam,
  validatePlayer,
  sanitizeMatchData,
  CONFIG,
} from "../utils/validation.js";
import {
  initializeDatabase,
  getNextMatchId,
  recordMatch,
  reserveMatchId,
} from "../db/database.js";

// Sample valid 5 players
const createValidPlayers = (prefix = "Player") => [
  { name: `${prefix} 1`, agent: "Jett", acs: 250, kda: "24/12/5", econ: 8500, firstBloods: 3, plants: 2, defuses: 1 },
  { name: `${prefix} 2`, agent: "Phoenix", acs: 240, kda: "22/10/4", econ: 8200, firstBloods: 2, plants: 1, defuses: 0 },
  { name: `${prefix} 3`, agent: "Sage", acs: 180, kda: "15/8/10", econ: 7800, firstBloods: 0, plants: 0, defuses: 3 },
  { name: `${prefix} 4`, agent: "Cypher", acs: 190, kda: "16/9/8", econ: 7500, firstBloods: 1, plants: 0, defuses: 2 },
  { name: `${prefix} 5`, agent: "Viper", acs: 200, kda: "18/11/7", econ: 7900, firstBloods: 1, plants: 1, defuses: 1 },
];

// Sample valid match
const createValidMatch = () => ({
  matchId: "M001",
  matchDate: "2026-09-06",
  teamA: {
    name: "TEAM PTSD",
    detectedColor: "red",
    players: createValidPlayers("PTSD"),
  },
  teamB: {
    name: "TEAM UltraViolence",
    detectedColor: "teal",
    players: createValidPlayers("UltraViolence"),
  },
});

test("Canonical Data Model - Valid Match", () => {
  const match = createValidMatch();
  const res = validateMatchData(match);
  assert.equal(res.valid, true, `Errors found: ${res.errors.join(", ")}`);
  assert.equal(res.errors.length, 0);

  const sanitized = sanitizeMatchData(match);
  assert.equal(sanitized.matchId, "M001");
  assert.equal(sanitized.matchDate, "2026-09-06");
  assert.equal(sanitized.teamA.name, "TEAM PTSD");
  assert.equal(sanitized.teamA.detectedColor, "red");
  assert.equal(sanitized.teamA.players.length, 5);
});

test("Canonical Data Model - Exactly 5 Players Per Team", () => {
  const match = createValidMatch();
  
  // Test 4 players in Team A
  match.teamA.players.pop();
  let res = validateMatchData(match);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes("must have exactly 5 players")));

  // Test 6 players in Team B
  const match6 = createValidMatch();
  match6.teamB.players.push({ name: "Player 6", agent: "Omen", acs: 150, kda: "10/10/5", econ: 5000, firstBloods: 0, plants: 0, defuses: 0 });
  res = validateMatchData(match6);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes("must have exactly 5 players")));
});

test("Canonical Data Model - Duplicate Teams", () => {
  const match = createValidMatch();
  match.teamB.name = match.teamA.name; // Same as teamA ("TEAM PTSD")
  const res = validateMatchData(match);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes("different teams")));
});

test("Canonical Data Model - Invalid Date", () => {
  const match1 = createValidMatch();
  delete match1.matchDate;
  let res = validateMatchData(match1);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes("date is required")));

  const match2 = createValidMatch();
  match2.matchDate = "09/06/2026"; // Invalid format
  res = validateMatchData(match2);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes("YYYY-MM-DD format")));
});

test("Canonical Data Model - Malformed Player", () => {
  const match = createValidMatch();

  // Missing required name
  match.teamA.players[0].name = "";
  // Bad KDA format
  match.teamA.players[1].kda = "22-10-4";
  // Non-numeric ACS
  match.teamA.players[2].acs = "invalid_number";

  const res = validateMatchData(match);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes("Player is required") || e.includes("name is required")));
  assert.ok(res.errors.some(e => e.includes("format XX/XX/XX")));
  assert.ok(res.errors.some(e => e.includes("valid number")));
});

test("Canonical Data Model - Malformed Match Payload", () => {
  assert.equal(validateMatchData(null).valid, false);
  assert.equal(validateMatchData(undefined).valid, false);
  assert.equal(validateMatchData("not an object").valid, false);
  assert.equal(validateMatchData({}).valid, false);
});

test("SQLite Database - Match ID Sequencing", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_matches_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);

    // Initial ID should be M001
    const id1 = await getNextMatchId(db);
    assert.equal(id1, "M001");

    // Record first match M001
    const match1 = createValidMatch();
    match1.matchId = id1;
    await recordMatch(db, match1);

    // Next ID should be M002
    const id2 = await getNextMatchId(db);
    assert.equal(id2, "M002");

    // Reserve M002 manually
    const reserved = await reserveMatchId(db);
    assert.equal(reserved, "M002");

    // Next ID should be M003
    const id3 = await getNextMatchId(db);
    assert.equal(id3, "M003");

    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  }
});
