import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { waitForServerReady } from "./server-health";

/**
 * CI helper invoked by the GitHub Actions workflow to block until the
 * Playwright-facing Next.js dev server responds to health probes.
 *
 * The step runs right after spawning the manual dev server instance so the
 * subsequent Playwright run can skip its own startup retries and begin testing
 * immediately. This mirrors the behaviour of the `waitForServerReady` utility
 * used in the Playwright auth setup while keeping the workflow readable.
 */
export function resolveHealthProbeBaseURL(
  env: NodeJS.ProcessEnv,
  fallbackHost = "127.0.0.1"
): string {
  /**
   * When the workflow explicitly provides a base URL (for example via
   * `PLAYWRIGHT_TEST_BASE_URL`) we should honour that verbatim to support
   * bespoke reverse-proxy setups.
   */
  if (env.PLAYWRIGHT_TEST_BASE_URL) {
    return env.PLAYWRIGHT_TEST_BASE_URL;
  }

  /**
   * Developers typically run `pnpm dev` without specifying a port which binds
   * to 3000. Conversely the hermetic Playwright pipeline uses 3100 to avoid
   * clashing with concurrently running local servers. Mirror the
   * `resolveNextDevCommand` heuristics so the probe targets the correct port in
   * both environments while still respecting an explicit `PORT` override when
   * one is provided.
   */
  const hermeticFlagsEnabled =
    env.PLAYWRIGHT === "true" ||
    env.CI_PLAYWRIGHT === "true" ||
    env.HERMETIC_CHAT_PROVIDER === "true";

  const port = env.PORT ?? (hermeticFlagsEnabled ? "3100" : "3000");

  return `http://${fallbackHost}:${port}`;
}

async function main() {
  const baseURL = resolveHealthProbeBaseURL(process.env);

  console.log(
    `[ci-wait-for-health] Probing ${baseURL} before executing Playwright tests.`
  );

  try {
    await waitForServerReady(baseURL, {
      /**
       * CI machines occasionally take longer than local laptops to warm the dev
       * server, especially after dependency installation. Increase the attempt
       * budget to roughly one minute so we have ample headroom before failing
       * the pipeline.
       */
      attempts: 60,
      delayMs: 1_000,
    });
  } catch (error) {
    console.error(
      "[ci-wait-for-health] Next.js dev server failed to answer readiness probes.",
      error
    );
    process.exit(1);
  }
}

const executedDirectly = (() => {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }

  return fileURLToPath(import.meta.url) === path.resolve(scriptPath);
})();

if (executedDirectly) {
  void main();
}
