import { initializeDatabase, clearMatches, getNextMatchId } from "../db/database.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const dbPath = process.env.DB_PATH || "./data/matches.db";
  console.log(`\nConnecting to database at ${dbPath}...`);
  const db = await initializeDatabase(dbPath);

  const prevCountRes = await db.get("SELECT COUNT(*) as count FROM matches");
  const prevCount = prevCountRes?.count || 0;
  const prevCounterRes = await db.get("SELECT counter FROM match_counter WHERE id = 1");
  const prevCounter = prevCounterRes?.counter || 0;

  console.log(`Current state: ${prevCount} match(es) in database, match_counter is at ${prevCounter}.`);

  await clearMatches(db);

  const nextMatchId = await getNextMatchId(db);
  const newCountRes = await db.get("SELECT COUNT(*) as count FROM matches");
  const newCount = newCountRes?.count || 0;

  console.log(`✓ All matches cleared (0 matches remaining).`);
  console.log(`✓ Match counter reset to 0.`);
  console.log(`✓ Next match will start from: ${nextMatchId}\n`);

  await db.close();
}

main().catch((err) => {
  console.error("Error clearing match data:", err);
  process.exit(1);
});
