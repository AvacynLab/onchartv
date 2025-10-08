import { spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

import {
  resolveNextDevCommand,
  type NextDevCommand,
} from "./next-dev-command";
import { prepareDevServerLogFile } from "./dev-server-logs";

/**
 * Launch the Next.js dev server while teeing its stdout/stderr streams to a
 * timestamped log file. The captured output helps future contributors debug
 * flaky Playwright runs (for example the intermittent `ERR_EMPTY_RESPONSE`
 * crashes) without having to reproduce them locally.
 */

async function main() {
  const { logPath, rotatedLogPath } = prepareDevServerLogFile();
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  if (rotatedLogPath) {
    console.log(`Previous Next.js dev server log moved to ${rotatedLogPath}`);
  }

  console.log(`Writing Next.js dev server output to ${logPath}`);

  const nextDevCommand: NextDevCommand = resolveNextDevCommand(process.env);

  console.log(
    `Launching Next.js via "${nextDevCommand.command} ${nextDevCommand.args.join(" ")}". ${nextDevCommand.rationale}`
  );

  const child = spawn(nextDevCommand.command, nextDevCommand.args, {
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  const forwardChunk = (chunk: Buffer | string, target: NodeJS.WriteStream) => {
    target.write(chunk);
    logStream.write(chunk);
  };

  child.stdout?.on("data", (chunk) => forwardChunk(chunk, process.stdout));
  child.stderr?.on("data", (chunk) => forwardChunk(chunk, process.stderr));

  const closeLogStream = () =>
    new Promise<void>((resolve, reject) => {
      logStream.end((error: NodeJS.ErrnoException | null | undefined) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

  const handleExit = async (code: number | null, signal: NodeJS.Signals | null) => {
    try {
      await closeLogStream();
    } catch (error) {
      console.error("Failed to close dev server log", error);
    }

    if (code !== null) {
      process.exit(code);
    }

    if (signal) {
      process.kill(process.pid, signal);
    }

    process.exit(0);
  };

  child.on("exit", handleExit);
  child.on("error", async (error) => {
    console.error("Failed to start Next.js dev server", error);
    await handleExit(1, null);
  });

  const shutdown = (signal: NodeJS.Signals) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
