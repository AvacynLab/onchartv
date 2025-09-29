import fs from "node:fs";
import path from "node:path";

/**
 * Directory used to persist the Next.js dev server logs generated during
 * Playwright runs. Keeping the logs on disk makes it much easier to inspect
 * crashes such as the intermittent `ERR_EMPTY_RESPONSE` failures that have been
 * blocking the full suite.
 */
export const DEFAULT_DEV_SERVER_LOG_DIR = path.resolve(
  __dirname,
  "../.logs"
);

/** Name of the log file written by the Playwright-managed dev server. */
export const DEV_SERVER_LOG_BASENAME = "next-dev.log";

/**
 * Options accepted by {@link prepareDevServerLogFile} to make the helper
 * deterministic in unit tests.
 */
export type PrepareDevServerLogFileOptions = {
  /**
   * Override the directory used for the log file. Tests point this at a
   * temporary folder so they do not touch the real Playwright log directory.
   */
  baseDirectory?: string;
  /** Provide a deterministic timestamp factory for log rotation tests. */
  timestampFactory?: () => Date;
};

function formatTimestamp(date: Date): string {
  const iso = date.toISOString();
  return iso.replace(/[:.]/g, "-");
}

function resolveLogDirectory(baseDirectory?: string): string {
  return path.resolve(baseDirectory ?? DEFAULT_DEV_SERVER_LOG_DIR);
}

/**
 * Prepare the dev-server log directory and ensure a clean file is available for
 * the upcoming run. When a previous log file exists we rotate it by appending a
 * timestamped suffix so contributors can compare multiple failures.
 */
export function prepareDevServerLogFile(
  options: PrepareDevServerLogFileOptions = {}
): {
  directory: string;
  logPath: string;
  rotatedLogPath?: string;
} {
  const directory = resolveLogDirectory(options.baseDirectory);
  fs.mkdirSync(directory, { recursive: true });

  const logPath = path.join(directory, DEV_SERVER_LOG_BASENAME);

  let rotatedLogPath: string | undefined;
  if (fs.existsSync(logPath)) {
    const timestamp = formatTimestamp(
      options.timestampFactory ? options.timestampFactory() : new Date()
    );
    const { name } = path.parse(DEV_SERVER_LOG_BASENAME);
    rotatedLogPath = path.join(directory, `${name}-${timestamp}.log`);

    if (fs.existsSync(rotatedLogPath)) {
      fs.rmSync(rotatedLogPath);
    }

    fs.renameSync(logPath, rotatedLogPath);
  }

  if (fs.existsSync(logPath)) {
    fs.rmSync(logPath);
  }

  const fd = fs.openSync(logPath, "a");
  fs.closeSync(fd);

  return { directory, logPath, rotatedLogPath };
}
