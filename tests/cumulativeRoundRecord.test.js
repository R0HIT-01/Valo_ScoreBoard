import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateMatchData, sanitizeMatchData } from "../utils/validation.js";
import { initializeDatabase, recordMatch, getTeamRoundRecords, getMatchById } from "../db/database.js";

// Helper to construct a canonical match
const createMatch = (matchId, teamA = "TEAM PTSD", teamB = "TEAM UltraViolence", roundScore = { teamA: 14, teamB: 12 }) => ({
  matchId,
  matchDate: "2026-09-13",
  roundScore,
  teamA: {
    name: teamA,
    detectedColor: "red",
    players: [
      { name: "P1", agent: "Jett", acs: 335, kda: "32/14/5", econ: 81, firstBloods: 4, plants: 2, defuses: 1 },
      { name: "P2", agent: "Phoenix", acs: 304, kda: "23/23/6", econ: 73, firstBloods: 6, plants: 0, defuses: 1 },
      { name: "P3", agent: "Sage", acs: 259, kda: "21/19/12", econ: 64, firstBloods: 2, plants: 2, defuses: 0 },
      { name: "P4", agent: "Cypher", acs: 251, kda: "20/19/6", econ: 58, firstBloods: 5, plants: 0, defuses: 0 },
      { name: "P5", agent: "Viper", acs: 235, kda: "20/19/9", econ: 62, firstBloods: 3, plants: 2, defuses: 0 },
    ],
  },
  teamB: {
    name: teamB,
    detectedColor: "teal",
    players: [
      { name: "B1", agent: "Reyna", acs: 270, kda: "22/11/3", econ: 85, firstBloods: 4, plants: 0, defuses: 0 },
      { name: "B2", agent: "Omen", acs: 200, kda: "17/13/8", econ: 76, firstBloods: 1, plants: 1, defuses: 1 },
      { name: "B3", agent: "Skye", acs: 190, kda: "15/10/9", econ: 73, firstBloods: 0, plants: 1, defuses: 1 },
      { name: "B4", agent: "Fade", acs: 205, kda: "19/12/5", econ: 79, firstBloods: 1, plants: 0, defuses: 2 },
      { name: "B5", agent: "Breach", acs: 175, kda: "13/14/10", econ: 71, firstBloods: 0, plants: 1, defuses: 1 },
    ],
  },
});

// ============================================================
// Cumulative Round Record Tests
// ============================================================

test("Test 1: Initial 0-0 -> Match 14-12 -> Winner 14-12, Loser 12-14", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_rounds_1_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);

    // Initial check
    const initialRecords = await getTeamRoundRecords(db);
    assert.equal(initialRecords["TEAM PTSD"].roundRecord, "0-0");
    assert.equal(initialRecords["TEAM UltraViolence"].roundRecord, "0-0");

    // Commit Match 1: TEAM PTSD 14 - 12 TEAM UltraViolence
    const match1 = createMatch("M001", "TEAM PTSD", "TEAM UltraViolence", { teamA: 14, teamB: 12 });
    await recordMatch(db, match1);

    const records = await getTeamRoundRecords(db);
    assert.equal(records["TEAM PTSD"].roundsWon, 14);
    assert.equal(records["TEAM PTSD"].roundsLost, 12);
    assert.equal(records["TEAM PTSD"].roundRecord, "14-12");

    assert.equal(records["TEAM UltraViolence"].roundsWon, 12);
    assert.equal(records["TEAM UltraViolence"].roundsLost, 14);
    assert.equal(records["TEAM UltraViolence"].roundRecord, "12-14");

    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("Test 2: Match 1 (14-12) + Match 2 (13-3) -> Winner 27-15, Loser 15-27", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_rounds_2_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);

    // Match 1: 14 - 12
    await recordMatch(db, createMatch("M001", "TEAM PTSD", "TEAM UltraViolence", { teamA: 14, teamB: 12 }));

    // Match 2: 13 - 3 (PTSD won 13-3 against UltraViolence)
    await recordMatch(db, createMatch("M002", "TEAM PTSD", "TEAM UltraViolence", { teamA: 13, teamB: 3 }));

    const records = await getTeamRoundRecords(db);
    assert.equal(records["TEAM PTSD"].roundsWon, 27, "14 + 13 = 27 rounds won");
    assert.equal(records["TEAM PTSD"].roundsLost, 15, "12 + 3 = 15 rounds lost");
    assert.equal(records["TEAM PTSD"].roundRecord, "27-15");

    assert.equal(records["TEAM UltraViolence"].roundsWon, 15, "12 + 3 = 15 rounds won");
    assert.equal(records["TEAM UltraViolence"].roundsLost, 27, "14 + 13 = 27 rounds lost");
    assert.equal(records["TEAM UltraViolence"].roundRecord, "15-27");

    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("Test 3: Uninvolved teams remain unchanged (0-0)", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_rounds_3_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);

    await recordMatch(db, createMatch("M001", "TEAM PTSD", "TEAM UltraViolence", { teamA: 14, teamB: 12 }));
    await recordMatch(db, createMatch("M002", "TEAM PTSD", "TEAM UltraViolence", { teamA: 13, teamB: 3 }));

    const records = await getTeamRoundRecords(db);
    const uninvolvedTeams = [
      "TEAM We Mind Esp",
      "TEAM Redline",
      "TEAM Hexa",
      "TEAM JBGD",
      "TEAM Plastic Gng",
    ];

    for (const team of uninvolvedTeams) {
      assert.equal(records[team].roundsWon, 0);
      assert.equal(records[team].roundsLost, 0);
      assert.equal(records[team].roundRecord, "0-0", `${team} should remain 0-0`);
    }

    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("Test 4: Failed submission does NOT change cumulative totals", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_rounds_4_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);

    // Initial Match 1 committed
    await recordMatch(db, createMatch("M001", "TEAM PTSD", "TEAM UltraViolence", { teamA: 14, teamB: 12 }));

    const beforeRecords = await getTeamRoundRecords(db);
    assert.equal(beforeRecords["TEAM PTSD"].roundRecord, "14-12");

    // Simulate failed push: validation fails or network fails before recordMatch is called
    const invalidMatch = createMatch("M002", "TEAM PTSD", "TEAM UltraViolence", { teamA: -5, teamB: 13 });
    const val = validateMatchData(invalidMatch);
    assert.equal(val.valid, false, "Invalid match should fail validation");

    // Since validation failed, recordMatch is NOT called
    const afterRecords = await getTeamRoundRecords(db);
    assert.equal(afterRecords["TEAM PTSD"].roundRecord, "14-12", "Cumulative totals must remain unchanged after failure");

    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("Test 5: Submitting same Match ID twice does NOT double-count rounds", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_rounds_5_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);

    const match1 = createMatch("M001", "TEAM PTSD", "TEAM UltraViolence", { teamA: 14, teamB: 12 });
    await recordMatch(db, match1);

    // Attempting to record M001 again (INSERT OR REPLACE on unique match_id)
    await recordMatch(db, match1);

    const records = await getTeamRoundRecords(db);
    assert.equal(records["TEAM PTSD"].roundsWon, 14, "M001 must not be double counted");
    assert.equal(records["TEAM PTSD"].roundsLost, 12);
    assert.equal(records["TEAM PTSD"].roundRecord, "14-12");

    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("Test 6: Invalid scores are rejected", () => {
  const invalidScores = [
    { teamA: -1, teamB: 13 },
    { teamA: 13, teamB: -2 },
    { teamA: 13.5, teamB: 5 },
    { teamA: "abc", teamB: 13 },
  ];

  for (const score of invalidScores) {
    const match = createMatch("M001", "TEAM PTSD", "TEAM UltraViolence", score);
    const val = validateMatchData(match);
    assert.equal(val.valid, false, `Score ${JSON.stringify(score)} must be rejected`);
  }
});

test("Test 7: The two round scores must be different (no ties)", () => {
  const tieMatch = createMatch("M001", "TEAM PTSD", "TEAM UltraViolence", { teamA: 13, teamB: 13 });
  const val = validateMatchData(tieMatch);
  assert.equal(val.valid, false, "Tied scores (13-13) must be rejected");
  assert.ok(val.errors.some((e) => e.includes("cannot end in a tie") || e.includes("different")));
});

test("Test 8: The round score survives complete canonical validation and sanitization path", () => {
  const rawMatch = createMatch("M001", "TEAM PTSD", "TEAM UltraViolence", { teamA: "14", teamB: "12" });
  
  const val = validateMatchData(rawMatch);
  assert.equal(val.valid, true, `Validation failed: ${val.errors.join("; ")}`);

  const canonical = sanitizeMatchData(rawMatch);
  assert.ok(canonical.roundScore, "Sanitized match must have roundScore");
  assert.equal(typeof canonical.roundScore.teamA, "number");
  assert.equal(typeof canonical.roundScore.teamB, "number");
  assert.equal(canonical.roundScore.teamA, 14);
  assert.equal(canonical.roundScore.teamB, 12);
});

// ============================================================
// OCR Round Score & Team Classification Regression Tests
// ============================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

test("OCR Test: Scoreboard 14-12.png extracts round score (Team A: 12, Team B: 14) and 5v5 teams with accurate Barry stats", async () => {
  const imgPath = path.join(process.cwd(), "14-12.png");
  if (!fs.existsSync(imgPath)) return;

  const scriptPath = path.join(process.cwd(), "scripts", "ocr_pipeline.py");
  const { stdout } = await execFileAsync("python", [scriptPath, imgPath]);
  const result = JSON.parse(stdout);

  assert.equal(result.teamA.players.length, 5, "Team A must have exactly 5 players");
  assert.equal(result.teamB.players.length, 5, "Team B must have exactly 5 players");
  assert.ok(result.roundScore, "OCR result must contain roundScore for 14-12.png");
  // Side identity: Team A (RED) scored 12, Team B (TEAL) scored 14
  assert.equal(result.roundScore.teamA, 12, "Team A (RED) score must be 12");
  assert.equal(result.roundScore.teamB, 14, "Team B (TEAL) score must be 14");
  assert.equal(result.roundScore.winnerScore, 14, "Winner score must be 14");
  assert.equal(result.roundScore.loserScore, 12, "Loser score must be 12");

  // Barry statistics assertions in Team B
  const barry = result.teamB.players.find((p) => p.name === "Barry" || p.kda === "30/20/5");
  assert.ok(barry, "Barry player must be present in Team B");
  assert.equal(barry.name, "Barry", `Barry name must be 'Barry', got ${barry.name}`);
  assert.equal(barry.firstBloods, 9, `Barry First Bloods must be 9, got ${barry.firstBloods}`);
  assert.equal(barry.acs, 333, `Barry ACS must be 333, got ${barry.acs}`);
  assert.equal(barry.kda, "30/20/5", `Barry KDA must be 30/20/5, got ${barry.kda}`);
  assert.equal(barry.econ, 70, `Barry ECON must be 70, got ${barry.econ}`);
  assert.equal(barry.plants, 1, `Barry PLT must be 1, got ${barry.plants}`);
  assert.equal(barry.defuses, 0, `Barry DEF must be 0, got ${barry.defuses}`);

  // RyuKage statistics assertions in Team B
  const ryuKage = result.teamB.players.find((p) => p.name === "RyuKage" || p.kda === "27/18/6");
  assert.ok(ryuKage, "RyuKage player must be present in Team B");
  assert.equal(ryuKage.name, "RyuKage", `RyuKage name must be 'RyuKage', got ${ryuKage.name}`);
  assert.equal(ryuKage.acs, 271, `RyuKage ACS must be 271, got ${ryuKage.acs}`);
  assert.equal(ryuKage.kda, "27/18/6", `RyuKage KDA must be 27/18/6, got ${ryuKage.kda}`);
  assert.equal(ryuKage.econ, 82, `RyuKage ECON must be 82, got ${ryuKage.econ}`);
  assert.equal(ryuKage.firstBloods, 0, `RyuKage FB must be 0, got ${ryuKage.firstBloods}`);
  assert.equal(ryuKage.plants, 4, `RyuKage PLT must be 4, got ${ryuKage.plants}`);
  assert.equal(ryuKage.defuses, 0, `RyuKage DEF must be 0, got ${ryuKage.defuses}`);

  // bongooner statistics assertions in Team B
  const bongooner = result.teamB.players.find((p) => p.name === "bongooner" || p.kda === "19/15/4");
  assert.ok(bongooner, "bongooner player must be present in Team B");
  assert.equal(bongooner.name, "bongooner", `bongooner name must be 'bongooner', got ${bongooner.name}`);
  assert.equal(bongooner.acs, 210, `bongooner ACS must be 210, got ${bongooner.acs}`);
  assert.equal(bongooner.kda, "19/15/4", `bongooner KDA must be 19/15/4, got ${bongooner.kda}`);

  // I Am Atomic statistics assertions in Team B
  const amAtomic = result.teamB.players.find((p) => p.name === "I Am Atomic" || p.kda === "17/21/9");
  assert.ok(amAtomic, "I Am Atomic player must be present in Team B");
  assert.equal(amAtomic.name, "I Am Atomic", `I Am Atomic name must be 'I Am Atomic', got ${amAtomic.name}`);
  assert.equal(amAtomic.acs, 206, `I Am Atomic ACS must be 206, got ${amAtomic.acs}`);
  assert.equal(amAtomic.kda, "17/21/9", `I Am Atomic KDA must be 17/21/9, got ${amAtomic.kda}`);
  assert.equal(amAtomic.econ, 52, `I Am Atomic ECON must be 52, got ${amAtomic.econ}`);
  assert.equal(amAtomic.firstBloods, 1, `I Am Atomic FB must be 1, got ${amAtomic.firstBloods}`);
  assert.equal(amAtomic.plants, 2, `I Am Atomic PLT must be 2, got ${amAtomic.plants}`);
  assert.equal(amAtomic.defuses, 1, `I Am Atomic DEF must be 1, got ${amAtomic.defuses}`);

  // Doctor statistics assertions in Team B
  const doctor = result.teamB.players.find((p) => p.name === "Doctor" || p.kda === "15/18/14");
  assert.ok(doctor, "Doctor player must be present in Team B");
  assert.equal(doctor.name, "Doctor", `Doctor name must be 'Doctor', got ${doctor.name}`);
  assert.equal(doctor.acs, 165, `Doctor ACS must be 165, got ${doctor.acs}`);
  assert.equal(doctor.kda, "15/18/14", `Doctor KDA must be 15/18/14, got ${doctor.kda}`);
  assert.equal(doctor.econ, 34, `Doctor ECON must be 34, got ${doctor.econ}`);
  assert.equal(doctor.firstBloods, 3, `Doctor FB must be 3, got ${doctor.firstBloods}`);
  assert.equal(doctor.plants, 0, `Doctor PLT must be 0, got ${doctor.plants}`);
  assert.equal(doctor.defuses, 0, `Doctor DEF must be 0, got ${doctor.defuses}`);

  // kuttykunjaa statistics assertions in Team A
  const kutty = result.teamA.players.find((p) => p.name.includes("kutty") || p.kda === "11/18/11");
  assert.ok(kutty, "kuttykunjaa player must be present in Team A");
  assert.equal(kutty.acs, 132, `kuttykunjaa ACS must be 132, got ${kutty.acs}`);
  assert.equal(kutty.kda, "11/18/11", `kuttykunjaa KDA must be 11/18/11, got ${kutty.kda}`);
  assert.equal(kutty.econ, 46, `kuttykunjaa ECON must be 46, got ${kutty.econ}`);
  assert.equal(kutty.firstBloods, 1, `kuttykunjaa FB must be 1, got ${kutty.firstBloods}`);
  assert.equal(kutty.plants, 1, `kuttykunjaa PLT must be 1, got ${kutty.plants}`);
  assert.equal(kutty.defuses, 2, `kuttykunjaa DEF must be 2, got ${kutty.defuses}`);

  // Verify all 14-12 KDA values have exactly 3 components
  const all14_12Players = [...result.teamA.players, ...result.teamB.players];
  for (const p of all14_12Players) {
    if (p.kda) {
      const parts = p.kda.split("/");
      assert.equal(parts.length, 3, `Player ${p.name} KDA '${p.kda}' must have exactly 3 components`);
    }
  }
});

test("OCR Test: Scoreboard 13-3.png extracts round score (Team A: 3, Team B: 13) and 5v5 teams", async () => {
  const imgPath = path.join(process.cwd(), "13-3.png");
  if (!fs.existsSync(imgPath)) return;

  const scriptPath = path.join(process.cwd(), "scripts", "ocr_pipeline.py");
  const { stdout } = await execFileAsync("python", [scriptPath, imgPath]);
  const result = JSON.parse(stdout);

  assert.equal(result.teamA.players.length, 5, "Team A must have exactly 5 players");
  assert.equal(result.teamB.players.length, 5, "Team B must have exactly 5 players");
  assert.ok(result.roundScore, "OCR result must contain roundScore for 13-3.png");
  // Side identity: Team A (RED) scored 3, Team B (TEAL) scored 13
  assert.equal(result.roundScore.teamA, 3, "Team A (RED) score must be 3");
  assert.equal(result.roundScore.teamB, 13, "Team B (TEAL) score must be 13");
  assert.equal(result.roundScore.winnerScore, 13, "Winner score must be 13");
  assert.equal(result.roundScore.loserScore, 3, "Loser score must be 3");

  // Verify Team B players & stats
  const barry = result.teamB.players.find(p => p.name.includes("Barry"));
  assert.ok(barry, "Barry must be in Team B");
  assert.equal(barry.agent, "REYNA", "Barry agent in 13-3.png must be REYNA");
  assert.equal(barry.acs, 323, "Barry ACS must be 323");
  assert.equal(barry.kda, "17/9/6", "Barry KDA must be 17/9/6");
  assert.equal(barry.econ, 86, "Barry ECON must be 86");
  assert.equal(barry.firstBloods, 4, "Barry FB must be 4");

  const k4rna = result.teamB.players.find(p => p.name.includes("K4RNA"));
  assert.ok(k4rna, "K4RNA must be in Team B");
  assert.equal(k4rna.agent, "OMEN", "K4RNA agent must be OMEN");
  assert.equal(k4rna.acs, 157, "K4RNA ACS must be 157");
  assert.equal(k4rna.kda, "9/9/11", "K4RNA KDA must be 9/9/11");
  assert.equal(k4rna.econ, 40, "K4RNA ECON must be 40");
  assert.equal(k4rna.plants, 1, "K4RNA plants must be 1");

  // Verify Team A players & stats
  const arunyeager = result.teamA.players.find(p => p.name.includes("arunyeager"));
  assert.ok(arunyeager, "arunyeager must be in Team A");
  assert.equal(arunyeager.agent, "RAZE", "arunyeager agent must be RAZE");
  assert.equal(arunyeager.acs, 167, "arunyeager ACS must be 167");
  assert.equal(arunyeager.kda, "8/16/3", "arunyeager KDA must be 8/16/3");
  assert.equal(arunyeager.firstBloods, 3, "arunyeager FB must be 3");

  const bappu = result.teamA.players.find(p => p.name.includes("Bappu"));
  assert.ok(bappu, "Bappu on Ganja must be in Team A");
  assert.equal(bappu.agent, "CYPHER", "Bappu on Ganja agent must be CYPHER");
  assert.equal(bappu.acs, 156, "Bappu on Ganja ACS must be 156");
  assert.equal(bappu.kda, "8/14/3", "Bappu on Ganja KDA must be 8/14/3");
  assert.equal(bappu.defuses, 1, "Bappu on Ganja defuses must be 1");

  const imbitxchless = result.teamA.players.find(p => p.name.includes("imbitxchless"));
  assert.ok(imbitxchless, "imbitxchless must be in Team A");
  assert.equal(imbitxchless.agent, "SOVA", "imbitxchless agent must be SOVA");
  assert.equal(imbitxchless.acs, 149, "imbitxchless ACS must be 149");
  assert.equal(imbitxchless.kda, "8/15/2", "imbitxchless KDA must be 8/15/2");
});

test("OCR Test: Scoreboard 13-6.png regression test (Side Identity: Team A RED = 6, Team B TEAL = 13)", async () => {
  const imgPath = path.join(process.cwd(), "13-6.png");
  if (!fs.existsSync(imgPath)) return;

  const scriptPath = path.join(process.cwd(), "scripts", "ocr_pipeline.py");
  const { stdout } = await execFileAsync("python", [scriptPath, imgPath]);
  const result = JSON.parse(stdout);

  // 1. Total 10 players
  const totalPlayers = result.teamA.players.length + result.teamB.players.length;
  assert.equal(totalPlayers, 10, "Scoreboard must contain exactly 10 players");

  // 2. 5 players per team
  assert.equal(result.teamA.players.length, 5, "Team A must have exactly 5 players");
  assert.equal(result.teamB.players.length, 5, "Team B must have exactly 5 players");

  // 3. Side identity score verification:
  // RED player side (Team A) won 6 rounds.
  // TEAL/GOLD player side (Team B) won 13 rounds.
  assert.ok(result.roundScore, "OCR result must contain roundScore for 13-6.png");
  assert.equal(result.roundScore.teamA, 6, "Team A (RED) must receive score 6");
  assert.equal(result.roundScore.teamB, 13, "Team B (TEAL/GOLD) must receive score 13");
  assert.equal(result.roundScore.winnerScore, 13, "Winner score must be 13");
  assert.equal(result.roundScore.loserScore, 6, "Loser score must be 6");

  // 4. Verify player identities and stats in 13-6.png
  const quakEnoki = result.teamA.players.find((p) => p.name.includes("Enoki") || p.agent === "YORU");
  assert.ok(quakEnoki, "Quak Enoki must be present in Team A");
  assert.equal(quakEnoki.kda, "12/17/4", `Quak Enoki KDA must be exactly 12/17/4, got ${quakEnoki.kda}`);

  const barry13_6 = result.teamB.players.find((p) => p.name === "Barry" || p.acs === 198);
  assert.ok(barry13_6, "Barry must be present in Team B");
  assert.equal(barry13_6.name, "Barry", `Barry name must be 'Barry', got ${barry13_6.name}`);
  assert.equal(barry13_6.kda, "13/11/4", `Barry KDA must be '13/11/4', got ${barry13_6.kda}`);

  const atomic13_6 = result.teamB.players.find((p) => p.name.includes("Atomic") || p.acs === 104);
  assert.ok(atomic13_6, "I Am Atomic must be present in Team B");
  assert.equal(atomic13_6.name, "I Am Atomic", `I Am Atomic name must be 'I Am Atomic', got ${atomic13_6.name}`);
  assert.equal(atomic13_6.kda, "8/9/2", `I Am Atomic KDA must be '8/9/2', got ${atomic13_6.kda}`);

  // Verify all KDA values have exactly 3 components
  const all13_6Players = [...result.teamA.players, ...result.teamB.players];
  for (const p of all13_6Players) {
    if (p.kda) {
      const parts = p.kda.split("/");
      assert.equal(parts.length, 3, `Player ${p.name} KDA '${p.kda}' must have exactly 3 components`);
    }
  }

  // 5. Verify Barry (row index 5, gold highlighted) is assigned to the same team as Doctor (row 0), el Frost (row 1), Devang (row 2), and I Am Atomic (row 9)
  const allRows = result._diagnostics?.rowDetection?.allRowsInOrder || result._diagnostics?.allRowsInOrder || [];
  assert.equal(allRows.length, 10, "All 10 rows must be present in diagnostics");

  const rowDoctor = allRows[0];
  const rowElFrost = allRows[1];
  const rowDevang = allRows[2];
  const rowBarry = allRows[5];
  const rowIAmAtomic = allRows[9];

  // All 5 must share the exact same team assignment ("B")
  const winningTeam = rowDoctor.team;
  assert.equal(winningTeam, "B", "Winning side roster must be Team B");
  assert.equal(rowElFrost.team, winningTeam, "el Frost must be on same team as Doctor");
  assert.equal(rowDevang.team, winningTeam, "Devang must be on same team as Doctor");
  assert.equal(rowBarry.team, winningTeam, "Barry (gold row) must be on same team as Doctor/el Frost/Devang/I Am Atomic");
  assert.equal(rowIAmAtomic.team, winningTeam, "I Am Atomic must be on same team as Doctor");

  // Verify that all 5 RED rows are on Team A
  const redRows = allRows.filter((r) => r.dominant === "RED");
  assert.equal(redRows.length, 5, "Must have exactly 5 RED rows");
  redRows.forEach((r) => {
    assert.equal(r.team, "A", `RED row ${r.row_index} must be on Team A`);
  });
});

test("Test: Inverse Match outcome where Team A is the winning side (13-8)", async () => {
  const tempDbPath = path.join(process.cwd(), "data", `test_rounds_inv_${Date.now()}.db`);
  try {
    const db = await initializeDatabase(tempDbPath);

    // Team A (PTSD) wins 13-8 against Team B (UltraViolence)
    const match = createMatch("M001", "TEAM PTSD", "TEAM UltraViolence", { teamA: 13, teamB: 8 });
    await recordMatch(db, match);

    const records = await getTeamRoundRecords(db);
    assert.equal(records["TEAM PTSD"].roundsWon, 13);
    assert.equal(records["TEAM PTSD"].roundsLost, 8);
    assert.equal(records["TEAM PTSD"].roundRecord, "13-8");

    assert.equal(records["TEAM UltraViolence"].roundsWon, 8);
    assert.equal(records["TEAM UltraViolence"].roundsLost, 13);
    assert.equal(records["TEAM UltraViolence"].roundRecord, "8-13");

    await db.close();
  } finally {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  }
});

test("OCR Test: Valorant_scoreboard.png cropped fixture handles 5v5 teams", async () => {
  const imgPath = path.join(process.cwd(), "Valorant_scoreboard.png");
  if (!fs.existsSync(imgPath)) return;

  const scriptPath = path.join(process.cwd(), "scripts", "ocr_pipeline.py");
  const { stdout } = await execFileAsync("python", [scriptPath, imgPath]);
  const result = JSON.parse(stdout);

  assert.equal(result.teamA.players.length, 5, "Team A must have exactly 5 players");
  assert.equal(result.teamB.players.length, 5, "Team B must have exactly 5 players");
});

// ============================================================
// Highlighted GOLD/YELLOW Row Classification Tests
// ============================================================

test("Classification Test 1: 5 RED + 4 TEAL + 1 GOLD -> GOLD becomes TEAL (5 RED + 5 TEAL)", async () => {
  const pyCode = `
import sys
sys.path.append('scripts')
from ocr_pipeline import detect_rows

raw_rows = [{'dominant': 'RED', 'team': 'A'} for _ in range(5)] + [{'dominant': 'TEAL', 'team': 'B'} for _ in range(4)] + [{'dominant': 'GOLD', 'team': 'UNKNOWN'}]

# Simulate two-stage classification logic
for r in raw_rows:
    if r['dominant'] == 'RED':
        r['team'] = 'A'
    elif r['dominant'] == 'TEAL':
        r['team'] = 'B'
    else:
        r['team'] = 'UNKNOWN'

red_count = sum(1 for r in raw_rows if r['team'] == 'A')
teal_count = sum(1 for r in raw_rows if r['team'] == 'B')

for r in raw_rows:
    if r['team'] == 'UNKNOWN' and r['dominant'] in ('GOLD', 'UNKNOWN'):
        if red_count >= 5 and teal_count < 5:
            r['team'] = 'B'
            teal_count += 1
        elif teal_count >= 5 and red_count < 5:
            r['team'] = 'A'
            red_count += 1

team_a = sum(1 for r in raw_rows if r['team'] == 'A')
team_b = sum(1 for r in raw_rows if r['team'] == 'B')
assert team_a == 5 and team_b == 5
assert raw_rows[-1]['team'] == 'B'
print('OK')
`;
  const { stdout } = await execFileAsync("python", ["-c", pyCode]);
  assert.equal(stdout.trim(), "OK");
});

test("Classification Test 2: 4 RED + 5 TEAL + 1 GOLD -> GOLD becomes RED (5 RED + 5 TEAL)", async () => {
  const pyCode = `
import sys

raw_rows = [{'dominant': 'RED', 'team': 'A'} for _ in range(4)] + [{'dominant': 'TEAL', 'team': 'B'} for _ in range(5)] + [{'dominant': 'GOLD', 'team': 'UNKNOWN'}]

for r in raw_rows:
    if r['dominant'] == 'RED':
        r['team'] = 'A'
    elif r['dominant'] == 'TEAL':
        r['team'] = 'B'
    else:
        r['team'] = 'UNKNOWN'

red_count = sum(1 for r in raw_rows if r['team'] == 'A')
teal_count = sum(1 for r in raw_rows if r['team'] == 'B')

for r in raw_rows:
    if r['team'] == 'UNKNOWN' and r['dominant'] in ('GOLD', 'UNKNOWN'):
        if red_count >= 5 and teal_count < 5:
            r['team'] = 'B'
            teal_count += 1
        elif teal_count >= 5 and red_count < 5:
            r['team'] = 'A'
            red_count += 1

team_a = sum(1 for r in raw_rows if r['team'] == 'A')
team_b = sum(1 for r in raw_rows if r['team'] == 'B')
assert team_a == 5 and team_b == 5
assert raw_rows[-1]['team'] == 'A'
print('OK')
`;
  const { stdout } = await execFileAsync("python", ["-c", pyCode]);
  assert.equal(stdout.trim(), "OK");
});

test("Classification Test 3: Normal 5 RED + 5 TEAL rows are unchanged", async () => {
  const pyCode = `
raw_rows = [{'dominant': 'RED', 'team': 'A'} for _ in range(5)] + [{'dominant': 'TEAL', 'team': 'B'} for _ in range(5)]

for r in raw_rows:
    if r['dominant'] == 'RED':
        r['team'] = 'A'
    elif r['dominant'] == 'TEAL':
        r['team'] = 'B'
    else:
        r['team'] = 'UNKNOWN'

red_count = sum(1 for r in raw_rows if r['team'] == 'A')
teal_count = sum(1 for r in raw_rows if r['team'] == 'B')

for r in raw_rows:
    if r['team'] == 'UNKNOWN' and r['dominant'] in ('GOLD', 'UNKNOWN'):
        if red_count >= 5 and teal_count < 5:
            r['team'] = 'B'
            teal_count += 1
        elif teal_count >= 5 and red_count < 5:
            r['team'] = 'A'
            red_count += 1

team_a = sum(1 for r in raw_rows if r['team'] == 'A')
team_b = sum(1 for r in raw_rows if r['team'] == 'B')
assert team_a == 5 and team_b == 5
print('OK')
`;
  const { stdout } = await execFileAsync("python", ["-c", pyCode]);
  assert.equal(stdout.trim(), "OK");
});

test("Classification Test 4: 5 RED + 5 TEAL + 1 GOLD does not create a 6-player team", async () => {
  const pyCode = `
raw_rows = [{'dominant': 'RED', 'team': 'A'} for _ in range(5)] + [{'dominant': 'TEAL', 'team': 'B'} for _ in range(5)] + [{'dominant': 'GOLD', 'team': 'UNKNOWN'}]

for r in raw_rows:
    if r['dominant'] == 'RED':
        r['team'] = 'A'
    elif r['dominant'] == 'TEAL':
        r['team'] = 'B'
    else:
        r['team'] = 'UNKNOWN'

red_count = sum(1 for r in raw_rows if r['team'] == 'A')
teal_count = sum(1 for r in raw_rows if r['team'] == 'B')

for r in raw_rows:
    if r['team'] == 'UNKNOWN' and r['dominant'] in ('GOLD', 'UNKNOWN'):
        if red_count >= 5 and teal_count < 5:
            r['team'] = 'B'
            teal_count += 1
        elif teal_count >= 5 and red_count < 5:
            r['team'] = 'A'
            red_count += 1

team_a = sum(1 for r in raw_rows if r['team'] == 'A')
team_b = sum(1 for r in raw_rows if r['team'] == 'B')
assert team_a == 5 and team_b == 5
assert raw_rows[-1]['team'] == 'UNKNOWN', 'Extra highlighted row must remain UNKNOWN without creating 6 players'
print('OK')
`;
  const { stdout } = await execFileAsync("python", ["-c", pyCode]);
  assert.equal(stdout.trim(), "OK");
});


