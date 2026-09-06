import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { validatePlayer } from "../utils/validation.js";

/**
 * Custom Error class with error code support
 */
export class VisionError extends Error {
  constructor(message, code = "VISION_ERROR") {
    super(message);
    this.name = "VisionError";
    this.code = code;
  }
}

/**
 * Helper to sanitize individual player object fields
 */
function sanitizeExtractedPlayer(p, teamLabel, index) {
  return {
    name: String(p.name || `Player_${index + 1}`).trim(),
    agent: String(p.agent || "UNKNOWN").trim(),
    acs: Number(p.acs || 0),
    kda: p.kda !== undefined && p.kda !== null ? String(p.kda).trim() : "",
    econ: Number(p.econ || 0),
    firstBloods: Number(p.firstBloods !== undefined ? p.firstBloods : (p.fb !== undefined ? p.fb : 0)),
    plants: Number(p.plants || 0),
    defuses: Number(p.defuses || 0),
  };
}

/**
 * Analyze a Valorant scoreboard screenshot using the local Python OCR pipeline.
 *
 * Flow:
 * 1. Decode imageBase64 to temporary OS image file
 * 2. Invoke `python scripts/ocr_pipeline.py --image <temp_path>` via child_process.spawn
 * 3. Capture stdout JSON and stderr diagnostic logs
 * 4. Enforce process safety & timeout (30 seconds)
 * 5. Clean up temporary image file in all cases (success, failure, timeout)
 * 6. Parse and validate JSON against canonical schema
 *
 * @param {string} imageBase64 - Base64 encoded image string
 * @param {string} mimeType - Image MIME type (default "image/png")
 * @param {object} options - Optional execution parameters (timeoutMs, pythonExec, scriptPath)
 * @returns {Promise<{teamA: {detectedColor: string, players: Array}, teamB: {detectedColor: string, players: Array}}>}
 */
export async function analyzeScoreboard(imageBase64, mimeType = "image/png", options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const pythonExec = options.pythonExec || process.env.PYTHON_EXECUTABLE || "python";
  const scriptPath = options.scriptPath || path.resolve(process.cwd(), "scripts/ocr_pipeline.py");

  if (!imageBase64 || typeof imageBase64 !== "string" || imageBase64.trim() === "") {
    throw new VisionError("imageBase64 string is required", "IMAGE_DECODE_FAILED");
  }

  // Strip optional data URI scheme prefix (e.g. data:image/png;base64,)
  const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, "").trim();
  const buffer = Buffer.from(cleanB64, "base64");

  if (buffer.length === 0) {
    throw new VisionError("Invalid image base64 buffer (0 bytes)", "IMAGE_DECODE_FAILED");
  }

  // Determine file extension
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
  const tempFileName = `valorant_ocr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);

  try {
    // 1. Write temporary image file
    await fs.writeFile(tempFilePath, buffer);
  } catch (err) {
    throw new VisionError(`Failed to create temporary image file: ${err.message}`, "IMAGE_DECODE_FAILED");
  }

  try {
    // 2. Invoke Python OCR pipeline via child_process.spawn
    const result = await new Promise((resolve, reject) => {
      const child = spawn(pythonExec, [scriptPath, "--image", tempFilePath], {
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let isTimeout = false;

      const timer = setTimeout(() => {
        isTimeout = true;
        child.kill("SIGKILL");
        reject(new VisionError(`Python OCR process timed out after ${timeoutMs}ms`, "PYTHON_TIMEOUT"));
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (!isTimeout) {
          if (err.code === "ENOENT") {
            reject(new VisionError(`Python executable not found: "${pythonExec}"`, "PYTHON_NOT_FOUND"));
          } else {
            reject(new VisionError(`Failed to spawn Python process: ${err.message}`, "PYTHON_PROCESS_FAILED"));
          }
        }
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (isTimeout) return;

        if (code !== 0) {
          console.error("[VISION-OCR] Python process stderr:", stderr);
          reject(new VisionError(`Python OCR process exited with code ${code}: ${stderr.trim() || "Unknown error"}`, "PYTHON_PROCESS_FAILED"));
          return;
        }

        if (!stdout || stdout.trim() === "") {
          reject(new VisionError("Python OCR process produced empty output", "PYTHON_INVALID_JSON"));
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed);
        } catch (jsonErr) {
          console.error("[VISION-OCR] Invalid JSON output from Python:", stdout);
          reject(new VisionError(`Failed to parse Python OCR output as JSON: ${jsonErr.message}`, "PYTHON_INVALID_JSON"));
        }
      });
    });

    // 3. Validate extracted structure
    if (!result || typeof result !== "object") {
      throw new VisionError("Python OCR output is not a valid JSON object", "OCR_VALIDATION_FAILED");
    }

    if (!result.teamA || !result.teamB) {
      throw new VisionError("OCR result missing teamA or teamB", "OCR_VALIDATION_FAILED");
    }

    if (!Array.isArray(result.teamA.players) || result.teamA.players.length !== 5) {
      throw new VisionError(`Team A must have exactly 5 players, got ${result.teamA?.players?.length ?? 0}`, "OCR_VALIDATION_FAILED");
    }

    if (!Array.isArray(result.teamB.players) || result.teamB.players.length !== 5) {
      throw new VisionError(`Team B must have exactly 5 players, got ${result.teamB?.players?.length ?? 0}`, "OCR_VALIDATION_FAILED");
    }

    // 4. Validate player object fields
    const validationErrors = [];
    result.teamA.players.forEach((p, idx) => {
      const errs = validatePlayer(p, "Team A", idx);
      validationErrors.push(...errs);
    });

    result.teamB.players.forEach((p, idx) => {
      const errs = validatePlayer(p, "Team B", idx);
      validationErrors.push(...errs);
    });

    if (validationErrors.length > 0) {
      console.warn("[VISION-OCR] Validation warnings on extracted data:", validationErrors);
      // We log validation warnings but sanitize players into clean structure
    }

    const sanitizedTeamA = {
      detectedColor: result.teamA.detectedColor || "red",
      players: result.teamA.players.map((p, idx) => sanitizeExtractedPlayer(p, "Team A", idx)),
    };

    const sanitizedTeamB = {
      detectedColor: result.teamB.detectedColor || "teal",
      players: result.teamB.players.map((p, idx) => sanitizeExtractedPlayer(p, "Team B", idx)),
    };

    return {
      teamA: sanitizedTeamA,
      teamB: sanitizedTeamB,
    };
  } finally {
    // 5. Guaranteed cleanup of temporary image file in all cases
    try {
      await fs.unlink(tempFilePath);
    } catch (cleanupErr) {
      // Ignore if file doesn't exist or already removed
    }
  }
}
