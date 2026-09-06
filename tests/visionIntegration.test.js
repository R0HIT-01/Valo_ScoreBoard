import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";
import { analyzeScoreboard, VisionError } from "../services/visionService.js";

const TEST_IMAGE_PATH = path.resolve(process.cwd(), "Valorant_scoreboard.png");

test("Vision Integration - Valid Scoreboard Image (Real Screenshot)", async () => {
  if (!fs.existsSync(TEST_IMAGE_PATH)) {
    console.warn("[SKIP] Valorant_scoreboard.png not found, skipping real screenshot test");
    return;
  }

  const imageBuffer = fs.readFileSync(TEST_IMAGE_PATH);
  const imageBase64 = imageBuffer.toString("base64");

  const result = await analyzeScoreboard(imageBase64, "image/png");

  assert.ok(result, "Result object should exist");
  assert.ok(result.teamA, "teamA should exist");
  assert.ok(result.teamB, "teamB should exist");
  assert.strictEqual(result.teamA.detectedColor, "red");
  assert.strictEqual(result.teamB.detectedColor, "teal");
  assert.strictEqual(result.teamA.players.length, 5, "Team A must have 5 players");
  assert.strictEqual(result.teamB.players.length, 5, "Team B must have 5 players");

  // Validate player structure
  result.teamA.players.forEach((p, idx) => {
    assert.ok(p.name, `Team A Player ${idx + 1} name missing`);
    assert.ok(p.agent, `Team A Player ${idx + 1} agent missing`);
    assert.strictEqual(typeof p.acs, "number", `Team A Player ${idx + 1} acs must be number`);
    assert.ok(/^\d+\/\d+\/\d+$/.test(p.kda), `Team A Player ${idx + 1} KDA format invalid: ${p.kda}`);
    assert.strictEqual(typeof p.econ, "number", `Team A Player ${idx + 1} econ must be number`);
    assert.strictEqual(typeof p.firstBloods, "number", `Team A Player ${idx + 1} FB must be number`);
    assert.strictEqual(typeof p.plants, "number", `Team A Player ${idx + 1} plants must be number`);
    assert.strictEqual(typeof p.defuses, "number", `Team A Player ${idx + 1} defuses must be number`);
  });

  // Specific assertion for Venomnom's recovered KDA (16/19/5)
  const venomnom = result.teamB.players.find((p) => p.name.includes("Venomnom"));
  assert.ok(venomnom, "Venomnom player should be present in Team B");
  assert.strictEqual(venomnom.kda, "16/19/5", `Venomnom KDA must be recovered as 16/19/5, got ${venomnom.kda}`);
});

test("Vision Integration - Missing imageBase64 input", async () => {
  await assert.rejects(
    async () => {
      await analyzeScoreboard("", "image/png");
    },
    (err) => {
      assert.strictEqual(err.code, "IMAGE_DECODE_FAILED");
      return true;
    }
  );
});

test("Vision Integration - Invalid Base64 input (empty buffer)", async () => {
  await assert.rejects(
    async () => {
      await analyzeScoreboard("   ", "image/png");
    },
    (err) => {
      assert.strictEqual(err.code, "IMAGE_DECODE_FAILED");
      return true;
    }
  );
});

test("Vision Integration - Python Executable Not Found", async () => {
  const dummyB64 = Buffer.from("fake_image_bytes").toString("base64");
  await assert.rejects(
    async () => {
      await analyzeScoreboard(dummyB64, "image/png", {
        pythonExec: "non_existent_python_binary_xyz_123",
      });
    },
    (err) => {
      assert.strictEqual(err.code, "PYTHON_NOT_FOUND");
      return true;
    }
  );
});

test("Vision Integration - Python Timeout Enforcement", async () => {
  const dummyB64 = Buffer.from("fake_image_bytes").toString("base64");
  await assert.rejects(
    async () => {
      // 1ms timeout triggers timeout handling
      await analyzeScoreboard(dummyB64, "image/png", {
        timeoutMs: 1,
      });
    },
    (err) => {
      assert.strictEqual(err.code, "PYTHON_TIMEOUT");
      return true;
    }
  );
});

test("Vision Integration - Temporary Image Cleanup Verification", async () => {
  const tempFilesBefore = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("valorant_ocr_"));
  const dummyB64 = Buffer.from("fake_image_bytes").toString("base64");

  try {
    await analyzeScoreboard(dummyB64, "image/png", { timeoutMs: 1 });
  } catch (err) {
    // Expected timeout error
  }

  const tempFilesAfter = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("valorant_ocr_"));
  assert.strictEqual(
    tempFilesAfter.length,
    tempFilesBefore.length,
    "Temporary files must be cleaned up after execution/timeout"
  );
});
