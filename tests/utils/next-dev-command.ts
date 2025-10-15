import type { ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * Metadata describing how the Playwright launcher should start the Next.js dev
 * server. Splitting the process command and its arguments keeps the helper
 * testable without spawning child processes.
 */
export type NextDevCommand = {
  /** CLI executable used to start the dev server. */
  command: string;
  /** Arguments passed to the executable. */
  args: string[];
  /**
   * Human-readable note explaining why the command was selected. Useful when
   * logging decisions for downstream debugging.
   */
  rationale: string;
};

/**
 * Environment variables consulted when deciding how to launch the Next.js dev
 * server in test harnesses. Only the keys that influence the command selection
 * are surfaced here to simplify unit tests.
 */
export type NextDevEnvironment =
  & Partial<
      Pick<
        NodeJS.ProcessEnv,
        | "PLAYWRIGHT"
        | "CI_PLAYWRIGHT"
        | "PLAYWRIGHT_MANUAL_SERVER"
        | "HERMETIC_CHAT_PROVIDER"
      >
    >
  & NodeJS.ProcessEnv;

/**
 * Determine which command the Playwright helper should use to start the Next.js
 * development server. Hermetic test environments (Playwright/Vitest) struggle
 * with Turbopack's cold-start latency and module resolution quirks (e.g.
 * `@tanstack/react-query` being hidden behind pnpm's symlinks) which
 * previously caused `/chat` requests to time out or crash during warmup.
 * Falling back to the classic webpack dev server via `--no-turbo` when the
 * Playwright flags are present keeps the suite reliable while leaving the
 * default `pnpm dev --turbo` experience untouched for local developers.
 */
export function resolveNextDevCommand(env: NextDevEnvironment): NextDevCommand {
  const isPlaywrightEnabled =
    env.PLAYWRIGHT === "true" ||
    env.CI_PLAYWRIGHT === "true" ||
    env.HERMETIC_CHAT_PROVIDER === "true";

  const manualServerRequested = env.PLAYWRIGHT_MANUAL_SERVER === "true";

  if (manualServerRequested) {
    return {
      command: "pnpm",
      args: ["dev"],
      rationale:
        "Manual Playwright server requested; deferring to the default pnpm dev script.",
    };
  }

  if (isPlaywrightEnabled) {
    return {
      command: "pnpm",
      args: ["exec", "next", "dev", "--no-turbo"],
      rationale:
        "Playwright hermetic flags detected; launching Next.js with the classic webpack dev server via --no-turbo to avoid Turbopack cold-start delays and ESM resolution issues.",
    };
  }

  return {
    command: "pnpm",
    args: ["dev"],
    rationale:
      "No hermetic flags detected; using the default pnpm dev script with Turbopack for faster local refreshes.",
  };
}

/**
 * Small helper that mirrors `child_process.spawn`'s signature. Exported solely
 * for type-checking convenience when wiring the resolved command into the
 * Playwright launcher.
 */
export type SpawnFunction = (
  command: string,
  args: string[],
  options: Parameters<typeof import("node:child_process").spawn>[2]
) => ChildProcessWithoutNullStreams;
