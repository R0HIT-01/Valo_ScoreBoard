import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { analyzeScoreboard } from "./services/visionService.js";
import { googleSheetsService } from "./services/sheetsService.js";
import { initializeDatabase, getNextMatchId, reserveMatchId, recordMatch, getMatchById } from "./db/database.js";
import { validateMatchData, sanitizeMatchData } from "./utils/validation.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb" }));

// Global database instance
let db = null;

// Initialize on startup
async function startup() {
  try {
    console.log("🚀 Initializing Valorant Match Analyzer...");

    // Initialize database
    const dbPath = process.env.DB_PATH || "./data/matches.db";
    db = await initializeDatabase(dbPath);
    console.log(`✓ Database initialized at ${dbPath}`);

    // Verify Google Sheets API is configured (optional)
    if (googleSheetsService.isConfigured()) {
      try {
        googleSheetsService.initialize();
        console.log("✓ Google Sheets API client initialized");
      } catch (err) {
        console.warn("⚠ Google Sheets API not configured:", err.message);
        console.warn("  You can still analyze images, but cannot push to Sheets yet.");
      }
    } else {
      console.warn("⚠ Google Sheets not configured (optional)");
      console.warn("  You can test image analysis, but push-to-sheets will not work.");
      console.warn("  To enable: Add GOOGLE_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_EMAIL to .env");
    }

    // Vision service configured for Local Python OCR
    console.log("✓ Local Vision service configured (using Python OCR pipeline)");
    console.log("  Note: Processing running 100% locally via OpenCV + Tesseract");

    console.log("✅ Startup complete!\n");
  } catch (error) {
    console.error("❌ Startup failed:", error.message);
    process.exit(1);
  }
}

// ============================================
// ROUTES
// ============================================

/**
 * Health check endpoint
 */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Valorant Analyzer is running",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get configured team list
 * GET /api/teams
 */
app.get("/api/teams", async (req, res) => {
  try {
    const teams = await googleSheetsService.getTeams();
    res.json({ teams });
  } catch (error) {
    console.error("[TEAMS] Error:", error.message);
    res.status(502).json({
      error: `Google Sheets integration unreachable: ${error.message}`,
      code: "APPS_SCRIPT_UNREACHABLE",
    });
  }
});

/**
 * Initialize spreadsheet tabs and structure
 * POST /api/init-sheets
 */
app.post("/api/init-sheets", async (req, res) => {
  try {
    const result = await googleSheetsService.initialize();
    res.json({ ok: true, result });
  } catch (error) {
    console.error("[INIT-SHEETS] Error:", error.message);
    res.status(400).json({ error: error.message || "Failed to initialize spreadsheet" });
  }
});

/**
 * Analyze scoreboard screenshot
 * POST /api/analyze-scoreboard
 */
app.post("/api/analyze-scoreboard", async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/png" } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        error: "imageBase64 is required",
        code: "IMAGE_DECODE_FAILED",
      });
    }

    console.log("[ANALYZE] Analyzing scoreboard via Local Python OCR...");
    const result = await analyzeScoreboard(imageBase64, mimeType);

    console.log(
      `[ANALYZE] Success: ${result.teamA.players.length} Team A + ${result.teamB.players.length} Team B players extracted`
    );

    res.json(result);
  } catch (error) {
    console.error("[ANALYZE] Error:", error.message);
    const statusCode = error.code === "PYTHON_TIMEOUT" ? 504 : 400;
    res.status(statusCode).json({
      error: error.message || "Failed to analyze scoreboard",
      code: error.code || "VISION_ERROR",
    });
  }
});

/**
 * Push match (validate canonical match, append to Sheets, record in SQLite)
 * POST /api/push-match
 */
app.post("/api/push-match", async (req, res) => {
  try {
    const rawMatch = req.body;

    // 1. Validate using canonical match validation
    const validation = validateMatchData(rawMatch);
    if (!validation.valid) {
      return res.status(400).json({
        error: validation.errors.join("; "),
        errors: validation.errors,
      });
    }

    // 2. Sanitize to canonical match object
    const canonicalMatch = sanitizeMatchData(rawMatch);

    // 3. Ensure matchId is generated if missing
    if (!canonicalMatch.matchId) {
      canonicalMatch.matchId = await getNextMatchId(db);
    }

    // 3b. Check if user-entered matchId already exists in local SQLite DB
    const existingLocalMatch = await getMatchById(db, canonicalMatch.matchId);
    if (existingLocalMatch) {
      return res.status(400).json({
        error: `Match ID ${canonicalMatch.matchId} already exists. Please choose another Match ID.`,
        code: "DUPLICATE_MATCH_ID",
      });
    }

    console.log(`[PUSH] Processing match ${canonicalMatch.matchId}...`);

    // 4. Perform Google Sheets append FIRST if configured
    let sheetsResult = null;
    let wasDuplicateRetry = false;

    if (googleSheetsService.isConfigured()) {
      try {
        sheetsResult = await googleSheetsService.appendMatch(canonicalMatch);
      } catch (sheetsErr) {
        // Handle retry idempotency: if Sheets returns DUPLICATE_MATCH_ID, check if match was already in Sheets
        if (sheetsErr.code === "DUPLICATE_MATCH_ID" || sheetsErr.message.includes("already exists")) {
          console.warn(`[PUSH] Duplicate Match ID detected for ${canonicalMatch.matchId}. Resolving as previously committed retry.`);
          wasDuplicateRetry = true;
          sheetsResult = {
            ok: true,
            matchId: canonicalMatch.matchId,
            message: `Match ${canonicalMatch.matchId} was previously committed to Google Sheets.`,
          };
        } else {
          // Re-throw any other error (sheets unconfigured, bad payload, missing tab, network error)
          // Counter is NOT reserved, SQLite record is NOT created. Zero ID gaps!
          throw sheetsErr;
        }
      }
    }

    // 5. Only after Sheets succeeds (or resolves retry) do we log to SQLite and reserve the counter
    const status = googleSheetsService.isConfigured() ? "COMMITTED_SHEETS" : "UNPUSHED_LOCAL";
    await recordMatch(db, canonicalMatch, status);

    const message = sheetsResult?.message || `Match ${canonicalMatch.matchId} recorded locally in SQLite database.`;

    console.log(`[PUSH] Success: ${message}`);

    res.json({
      ok: true,
      message,
      matchId: canonicalMatch.matchId,
      warning: wasDuplicateRetry ? "DUPLICATE_MATCH_ID_RESOLVED" : undefined,
    });
  } catch (error) {
    console.error("[PUSH] Error:", error.message);
    res.status(400).json({
      error: error.message || "Failed to push match",
      code: error.code || "PUSH_FAILED",
    });
  }
});



/**
 * Get next match ID (for frontend preview)
 * GET /api/next-match-id
 */
app.get("/api/next-match-id", async (req, res) => {
  try {
    const matchId = await getNextMatchId(db);
    res.json({ matchId });
  } catch (error) {
    console.error("[NEXT-ID] Error:", error.message);
    res.status(500).json({ error: "Failed to get next match ID" });
  }
});

/**
 * Get all matches history
 * GET /api/matches
 */
app.get("/api/matches", async (req, res) => {
  try {
    const matches = await db.all("SELECT * FROM matches ORDER BY created_at DESC");
    res.json({ matches });
  } catch (error) {
    console.error("[MATCHES] Error:", error.message);
    res.status(500).json({ error: "Failed to retrieve matches" });
  }
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ============================================
// START SERVER
// ============================================

startup().then(() => {
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  🎮 VALORANT MATCH ANALYZER - BACKEND  ║
║  🚀 Running on http://localhost:${PORT}       ║
╚════════════════════════════════════════╝
    `);
    console.log("Endpoints:");
    console.log(`  GET  /api/health`);
    console.log(`  POST /api/analyze-scoreboard`);
    console.log(`  POST /api/push-match`);
    console.log(`  GET  /api/next-match-id`);
    console.log(`  GET  /api/matches`);
    console.log();
  });
});

export default app;
