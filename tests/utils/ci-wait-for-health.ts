import process from "node:process";

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
async function main() {
  const baseURL =
    process.env.PLAYWRIGHT_TEST_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? "3100"}`;

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

void main();
