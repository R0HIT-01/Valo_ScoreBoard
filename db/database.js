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

  await db.run(
    `INSERT OR REPLACE INTO matches (match_id, team_a_name, team_b_name, match_date, pushed_at, raw_data)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [
      matchId,
      teamAName,
      teamBName,
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


export async function getMatchById(db, matchId) {
  return await db.get("SELECT * FROM matches WHERE match_id = ?", [matchId]);
}

export async function getAllMatches(db) {
  return await db.all("SELECT * FROM matches ORDER BY created_at DESC");
}

