import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEV_SERVER_LOG_BASENAME,
  prepareDevServerLogFile,
} from "../utils/dev-server-logs";

test("prepareDevServerLogFile creates directory and log", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-server-logs-"));

  const { directory, logPath, rotatedLogPath } = prepareDevServerLogFile({
    baseDirectory: tempDir,
  });

  assert.equal(directory, tempDir);
  assert.equal(path.basename(logPath), DEV_SERVER_LOG_BASENAME);
  assert.equal(fs.existsSync(logPath), true);
  assert.equal(rotatedLogPath, undefined);
});

test("prepareDevServerLogFile rotates existing logs with timestamp suffix", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-server-logs-"));
  const logPath = path.join(tempDir, DEV_SERVER_LOG_BASENAME);
  fs.writeFileSync(logPath, "previous run");

  const fixedDate = new Date("2024-10-05T12:34:56.789Z");
  const { rotatedLogPath } = prepareDevServerLogFile({
    baseDirectory: tempDir,
    timestampFactory: () => fixedDate,
  });

  assert.ok(rotatedLogPath);
  assert(rotatedLogPath?.includes("2024-10-05T12-34-56-789Z"));
  assert.equal(fs.existsSync(rotatedLogPath!), true);
  assert.equal(fs.readFileSync(rotatedLogPath!, "utf8"), "previous run");
  assert.equal(fs.existsSync(logPath), true);
  assert.equal(fs.readFileSync(logPath, "utf8"), "");
});
