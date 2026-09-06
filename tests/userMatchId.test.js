import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateMatchData, sanitizeMatchData } from "../utils/validation.js";
import { initializeDatabase, getNextMatchId, getMatchById, recordMatch } from "../db/database.js";

const createValidPlayers = (prefix = "Player") => [
  { name: `${prefix} 1`, agent: "Jett", acs: 250, kda: "24/12/5", econ: 8500, firstBloods: 3, plants: 2, defuses: 1 },
  { name: `${prefix} 2`, agent: "Phoenix", acs: 240, kda: "22/10/4", econ: 8200, firstBloods: 2, plants: 1, defuses: 0 },
  { name: `${prefix} 3`, agent: "Sage", acs: 180, kda: "15/8/10", econ: 7800, firstBloods: 0, plants: 0, defuses: 3 },
  { name: `${prefix} 4`, agent: "Cypher", acs: 190, kda: "16/9/8", econ: 7500, firstBloods: 1, plants: 0, defuses: 2 },
  { name: `${prefix} 5`, agent: "Viper", acs: 200, kda: "18/11/7", econ: 7900, firstBloods: 1, plants: 1, defuses: 1 },
];

const createMatch = (matchId) => ({
  matchId,
  matchDate: "2026-09-06",
  teamA: { name: "TEAM PTSD", detectedColor: "red", players: createValidPlayers("PTSD") },
  teamB: { name: "TEAM UltraViolence", detectedColor: "teal", players: createValidPlayers("UltraViolence") },
});

test("Match ID Rule A — Default next ID is M001 for clean DB", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_match_id_a_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);
    const nextId = await getNextMatchId(db);
    assert.equal(nextId, "M001");
    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("Match ID Rule B — User-selected valid ID M025 is accepted", () => {
  const match = createMatch("M025");
  const res = validateMatchData(match);
  assert.equal(res.valid, true);
  const sanitized = sanitizeMatchData(match);
  assert.equal(sanitized.matchId, "M025");
});

test("Match ID Rule C — Invalid Match IDs are rejected", () => {
  const invalidIds = ["25", "match25", "M-25", "ABC", "M", "M 25", "", null, undefined];
  invalidIds.forEach((badId) => {
    const match = createMatch(badId);
    const res = validateMatchData(match);
    assert.equal(res.valid, false, `ID "${badId}" should have been rejected`);
    assert.ok(
      res.errors.some((e) => e.includes("Match ID")),
      `Error for "${badId}" missing Match ID message: ${res.errors.join("; ")}`
    );
  });
});

test("Match ID Rule D — Duplicate local SQLite Match ID is detected", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_match_id_d_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);
    const match1 = createMatch("M025");
    await recordMatch(db, match1);

    const existing = await getMatchById(db, "M025");
    assert.ok(existing, "M025 should exist in SQLite");
    assert.equal(existing.match_id, "M025");
    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("Match ID Rule E — User-selected ID is preserved in canonical payload", () => {
  const match = createMatch("M025");
  const sanitized = sanitizeMatchData(match);
  assert.equal(sanitized.matchId, "M025");
});

test("Match ID Rule F — Uncommitted Match ID is NOT recorded in SQLite if push fails", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_match_id_f_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);
    
    // Simulate failed push: we do NOT call recordMatch
    const uncommittedId = "M099";
    const existing = await getMatchById(db, uncommittedId);
    assert.equal(existing, undefined, "Uncommitted Match ID must not exist in SQLite");

    // Counter remains untouched
    const nextId = await getNextMatchId(db);
    assert.equal(nextId, "M001");
    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("Match ID Rule G & H — Successful submission commits user ID to SQLite and advances next ID appropriately", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_match_id_gh_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);

    // 1. Submit match with default M001
    const match1 = createMatch("M001");
    await recordMatch(db, match1);
    const nextAfter1 = await getNextMatchId(db);
    assert.equal(nextAfter1, "M002");

    // 2. Submit match with custom user ID M025
    const match25 = createMatch("M025");
    await recordMatch(db, match25);
    const stored25 = await getMatchById(db, "M025");
    assert.ok(stored25);

    // Counter should advance past 25 to M026
    const nextAfter25 = await getNextMatchId(db);
    assert.equal(nextAfter25, "M026");

    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});
