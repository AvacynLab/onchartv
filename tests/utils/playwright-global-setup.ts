import type { FullConfig } from "@playwright/test";

/**
 * Duration (in milliseconds) waited between two consecutive health probes. The
 * value matches the dev server startup time observed on CI machines and keeps
 * the setup resilient to cold Next.js builds.
 */
const PROBE_INTERVAL_MS = 1_000;

/**
 * Maximum number of health-check attempts performed before failing the
 * Playwright bootstrap. Combined with {@link PROBE_INTERVAL_MS} this caps the
 * wait time to roughly 30 seconds, which is ample once the `webServer` hook has
 * already reported readiness.
 */
const MAX_PROBE_ATTEMPTS = 30;

const HEALTH_ENDPOINTS = ["/api/health", "/"] as const;

const sleep = (durationMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

/**
 * Playwright global setup ensuring the application answers HTTP requests before
 * the suites start executing. This avoids race conditions where the dev server
 * is technically up (per the `webServer.url` ping) but still compiling routes
 * such as `/api/finance/*`, which would otherwise lead to flaky 404s.
 */
export default async function globalSetup(config: FullConfig) {
  const candidateProjects = config.projects ?? [];
  const baseURL = candidateProjects.find((project) => project.use?.baseURL)?.use
    ?.baseURL;

  if (!baseURL) {
    return;
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_PROBE_ATTEMPTS; attempt += 1) {
    for (const endpoint of HEALTH_ENDPOINTS) {
      try {
        const url = new URL(endpoint, baseURL);
        const response = await fetch(url, {
          cache: "no-store",
          headers: {
            "x-playwright-health-check": "true",
          },
        });

        if (response.ok) {
          return;
        }

        lastError = new Error(
          `Health check returned status ${response.status} for ${url.toString()}.`
        );
      } catch (error) {
        lastError = error;
      }
    }

    await sleep(PROBE_INTERVAL_MS);
  }

  const failure =
    lastError instanceof Error
      ? lastError
      : new Error("Health check failed to reach the application server.");
  throw failure;
}
