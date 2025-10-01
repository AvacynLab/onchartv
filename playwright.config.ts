import path from "node:path";
import { URL } from "node:url";

import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

import { resolvePreferredPortSync } from "./tests/utils/port-resolver";

config({
  path: ".env.local",
});

if (!process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES) {
  /**
   * Point Next.js' font loader to a deterministic set of mocked responses so
   * the Playwright suite never reaches out to Google Fonts. This keeps the
   * tests hermetic and avoids network flakiness in CI.
   */
  process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = path.join(
    __dirname,
    "tests/mocks/google-fonts.js"
  );
}

if (process.env.PLAYWRIGHT === "true") {
  // Surface the Playwright flag to client components so they can disable
  // remote resources (avatars, TokenLens catalog fetches, etc.).
  process.env.NEXT_PUBLIC_PLAYWRIGHT = "true";
}

const isHermeticPlaywrightRun =
  process.env.PLAYWRIGHT === "true" ||
  process.env.CI_PLAYWRIGHT === "true" ||
  Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL);

/**
 * Persist the generated reports and traces in predictable locations so the CI
 * workflow can upload them as downloadable artifacts when the suite finishes.
 */
const htmlReportDir = path.join(__dirname, "playwright-report");
const blobReportPath = path.join(htmlReportDir, "blob-report.zip");
const artifactOutputDir = path.join(__dirname, "playwright-results");

/**
 * Keep the hermetic Playwright runs lightweight. The Next.js dev server tends
 * to drop connections or crash outright when eight workers hammer it in
 * parallel, which previously surfaced as `ERR_EMPTY_RESPONSE` and aborted
 * registration flows mid-suite. Limiting the worker pool prevents the dev
 * server from being overwhelmed while local ad-hoc runs without the
 * Playwright flags still benefit from a larger worker count.
 */
const workerCount = process.env.CI
  ? 2
  : isHermeticPlaywrightRun
    ? 2
    : 8;

const shouldStartWebServer = process.env.PLAYWRIGHT_MANUAL_SERVER !== "true";

/**
 * Determine which port Playwright should target. We strongly prefer reusing
 * port 3100 so the base URL matches the manual server guidance, but when a
 * previous Next.js instance crashed and left the socket bound we fall back to
 * an ephemeral port to keep the suite moving.
 */
const preferredPort = Number.parseInt(process.env.PORT ?? "3100", 10);

const manualBaseURL = process.env.PLAYWRIGHT_TEST_BASE_URL;
let resolvedPort = preferredPort;

if (process.env.PLAYWRIGHT_RESOLVED_PORT) {
  resolvedPort = Number.parseInt(process.env.PLAYWRIGHT_RESOLVED_PORT, 10);
}

if (manualBaseURL) {
  try {
    const parsed = new URL(manualBaseURL);
    if (parsed.port) {
      resolvedPort = Number.parseInt(parsed.port, 10);
    }
  } catch (error) {
    console.warn(
      "PLAYWRIGHT_TEST_BASE_URL is not a valid URL. Falling back to the preferred port.",
      error
    );
  }

  if (!process.env.PLAYWRIGHT_RESOLVED_PORT) {
    process.env.PLAYWRIGHT_RESOLVED_PORT = String(resolvedPort);
  }
}

if (shouldStartWebServer && !process.env.PLAYWRIGHT_RESOLVED_PORT) {
  const { port, didFallback } = resolvePreferredPortSync({
    preferredPort: resolvedPort,
  });

  resolvedPort = port;
  process.env.PORT = String(resolvedPort);
  process.env.PLAYWRIGHT_RESOLVED_PORT = String(resolvedPort);

  if (didFallback) {
    console.warn(
      `Preferred Playwright port was busy. Falling back to :${resolvedPort} for this run.`
    );
  }
} else if (!process.env.PORT) {
  process.env.PORT = String(resolvedPort);
}

const baseURL = manualBaseURL || `http://localhost:${resolvedPort}`;
const fullyParallel = !isHermeticPlaywrightRun;

export default defineConfig({
  testDir: "./tests",
  fullyParallel,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: workerCount,
  reporter: [
    ["list"],
    ["html", { outputFolder: htmlReportDir, open: "never" }],
    ["blob", { outputFile: blobReportPath }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  outputDir: artifactOutputDir,
  timeout: 240 * 1000,
  expect: {
    timeout: 240 * 1000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /setup\/.*\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "e2e",
      testMatch: /e2e\/.*\.(spec|test)\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/.auth/state.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "routes",
      testMatch: /routes\/.*\.test\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/.auth/state.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: shouldStartWebServer
    ? {
        command: "node --import tsx tests/utils/run-next-dev.ts",
        url: `${baseURL}/ping`,
        timeout: 120 * 1000,
        reuseExistingServer: !process.env.CI,
        env: {
          /**
           * Force the spawned Next.js dev server to activate the Playwright
           * feature flag so our hermetic database and asset mocks kick in.
           * Without this override the server attempts to reach Postgres and
           * Google Fonts, both of which are unavailable in CI.
           */
          PLAYWRIGHT: "true",
          PORT: String(resolvedPort),
        },
      }
    : undefined,
});
