import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initializeDatabase(dbPath = "./data/matches.db") {
  // Create data directory if it doesn't exist
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  // Enable foreign keys
  await db.exec("PRAGMA foreign_keys = ON");

  // Create tables if they don't exist
  await db.exec(`
    -- Match counter for sequential IDs
    CREATE TABLE IF NOT EXISTS match_counter (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      counter INTEGER NOT NULL DEFAULT 0,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Match history for auditing
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT UNIQUE NOT NULL,
      team_a_name TEXT NOT NULL,
      team_b_name TEXT NOT NULL,
      team_a_score INTEGER,
      team_b_score INTEGER,
      match_date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      pushed_at DATETIME,
      sheets_row_a INTEGER,
      sheets_row_b INTEGER,
      raw_data TEXT
    );

    -- Ensure counter exists
    INSERT OR IGNORE INTO match_counter (id, counter) VALUES (1, 0);
  `);

  // Safe schema migrations for existing database files
  try {
    await db.exec("ALTER TABLE matches ADD COLUMN team_a_score INTEGER");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE matches ADD COLUMN team_b_score INTEGER");
  } catch (e) {}

  return db;
}

export async function getNextMatchId(db) {
  const result = await db.get("SELECT counter FROM match_counter WHERE id = 1");
  const nextCounter = (result?.counter || 0) + 1;
  const matchId = `M${String(nextCounter).padStart(3, "0")}`;
  return matchId;
}

export async function reserveMatchId(db) {
  const nextMatchId = await getNextMatchId(db);
  await db.run("UPDATE match_counter SET counter = counter + 1, last_updated = CURRENT_TIMESTAMP WHERE id = 1");
  return nextMatchId;
}

export async function recordMatch(db, matchData, status = "COMMITTED_SHEETS") {
  const matchId = matchData.matchId || (await getNextMatchId(db));
  const teamAName = matchData.teamA?.name || matchData.teamAName;
  const teamBName = matchData.teamB?.name || matchData.teamBName;
  const matchDate = matchData.matchDate || matchData.date;
  const scoreA = matchData.roundScore?.teamA !== undefined ? matchData.roundScore.teamA : (matchData.teamA?.score !== undefined ? matchData.teamA.score : null);
  const scoreB = matchData.roundScore?.teamB !== undefined ? matchData.roundScore.teamB : (matchData.teamB?.score !== undefined ? matchData.teamB.score : null);

  await db.run(
    `INSERT OR REPLACE INTO matches (match_id, team_a_name, team_b_name, team_a_score, team_b_score, match_date, pushed_at, raw_data)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [
      matchId,
      teamAName,
      teamBName,
      scoreA !== null && scoreA !== undefined ? Number(scoreA) : null,
      scoreB !== null && scoreB !== undefined ? Number(scoreB) : null,
      matchDate,
      JSON.stringify({ ...matchData, status }),
    ]
  );

  // Increment counter if this matchId exceeds current counter
  const currentCounterRes = await db.get("SELECT counter FROM match_counter WHERE id = 1");
  const currentCounter = currentCounterRes?.counter || 0;
  const matchNum = parseInt(matchId.replace(/^M/, ""), 10);

  if (!isNaN(matchNum) && matchNum > currentCounter) {
    await db.run("UPDATE match_counter SET counter = ?, last_updated = CURRENT_TIMESTAMP WHERE id = 1", [matchNum]);
  }

  return matchId;
}

/**
 * Compute cumulative round records for all configured teams from SQLite audit log
 */
export async function getTeamRoundRecords(db) {
  const matches = await db.all("SELECT * FROM matches ORDER BY created_at ASC");
  const CANONICAL_TEAMS = [
    "TEAM PTSD",
    "TEAM UltraViolence",
    "TEAM We Mind Esp",
    "TEAM Redline",
    "TEAM Hexa",
    "TEAM JBGD",
    "TEAM Plastic Gng",
  ];

  const records = {};
  CANONICAL_TEAMS.forEach((team) => {
    records[team] = {
      teamName: team,
      roundsWon: 0,
      roundsLost: 0,
      roundRecord: "0-0",
    };
  });

  for (const m of matches) {
    if (m.team_a_score !== null && m.team_b_score !== null && m.team_a_score !== undefined && m.team_b_score !== undefined) {
      const sA = Number(m.team_a_score);
      const sB = Number(m.team_b_score);
      const teamA = m.team_a_name;
      const teamB = m.team_b_name;

      if (!records[teamA]) records[teamA] = { teamName: teamA, roundsWon: 0, roundsLost: 0, roundRecord: "0-0" };
      if (!records[teamB]) records[teamB] = { teamName: teamB, roundsWon: 0, roundsLost: 0, roundRecord: "0-0" };

      records[teamA].roundsWon += sA;
      records[teamA].roundsLost += sB;
      records[teamA].roundRecord = `${records[teamA].roundsWon}-${records[teamA].roundsLost}`;

      records[teamB].roundsWon += sB;
      records[teamB].roundsLost += sA;
      records[teamB].roundRecord = `${records[teamB].roundsWon}-${records[teamB].roundsLost}`;
    }
  }

  return records;
}


export async function getMatchById(db, matchId) {
  return await db.get("SELECT * FROM matches WHERE match_id = ?", [matchId]);
}

export async function getAllMatches(db) {
  return await db.all("SELECT * FROM matches ORDER BY created_at DESC");
}

export async function clearMatches(db) {
  await db.run("DELETE FROM matches");
  try {
    await db.run("DELETE FROM sqlite_sequence WHERE name = 'matches'");
  } catch (e) {
    // sqlite_sequence table may not exist if autoincrement hasn't been used yet
  }
  await db.run("UPDATE match_counter SET counter = 0, last_updated = CURRENT_TIMESTAMP WHERE id = 1");
}

export const resetMatches = clearMatches;

