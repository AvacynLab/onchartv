import path from "node:path";
import { URL } from "node:url";

import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

import { resolvePreferredPortSync } from "./tests/utils/port-resolver";
import { collectOpenAIEnvVars } from "./tests/utils/openai-env";

config({
  path: ".env.local",
});

/**
 * Playwright runs should always expose the flag so server utilities (rate-limit,
 * finance mocks, etc.) can enable their hermetic paths. CI already sets the
 * variable but local invocations may omit it, hence the defensive default.
 */
if (!process.env.PLAYWRIGHT) {
  process.env.PLAYWRIGHT = "true";
}

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

if (!process.env.NEXT_PUBLIC_FEATURE_FINANCE) {
  /**
   * Keep the client-side finance flag aligned with the server toggle during e2e
   * runs. This prevents the Playwright bootstrapping code from rendering
   * finance components when the feature is deliberately disabled.
   */
  process.env.NEXT_PUBLIC_FEATURE_FINANCE =
    process.env.FEATURE_FINANCE ?? "true";
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
 * Mirror the boilerplate’s behaviour by forwarding the OpenAI credentials to
 * the Playwright-managed dev server. Without this explicit propagation the
 * Next.js process launched by Playwright would miss the secrets when CI runs
 * with a minimal environment, causing the chat routes to fall back to the
 * hermetic mocks even when we expect real completions.
 */
const openAIEnvVars = collectOpenAIEnvVars(process.env as NodeJS.ProcessEnv);

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
  globalSetup: "./tests/utils/playwright-global-setup.ts",
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
    /**
     * Force the Playwright-driven Chromium process to propagate the same feature
     * flags as the server. Without this explicit environment bridge certain
     * helper utilities (e.g. rate-limit bypass checks executed via
     * `page.evaluate`) would observe `undefined` and fall back to production
     * defaults, which in turn reintroduces the flaky 429s we previously saw in
     * CI. Keeping the variables in sync ensures the browser and server behave
     * consistently during hermetic runs.
     */
    launchOptions: {
      env: {
        PLAYWRIGHT: "true",
        FEATURE_FINANCE: process.env.FEATURE_FINANCE ?? "true",
      },
    },
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
        /**
         * Wait for the dedicated health endpoint rather than a generic ping so
         * we only start the suites once the API layer is ready. This prevents
         * Playwright from hammering partially compiled `/api/finance/*` routes,
         * which previously manifested as sporadic 404s during CI cold starts.
         */
        url: `${baseURL}/api/health`,
        // Allow extra time for the dev server to compile the finance bundles on
        // cold CI machines. The previous 120s budget was occasionally tight
        // when Playwright requested a rebuild after installing dependencies.
        timeout: 180 * 1000,
        reuseExistingServer: !process.env.CI,
        env: {
          ...openAIEnvVars,
          /**
           * Force the spawned Next.js dev server to activate the Playwright
           * feature flag so our hermetic database and asset mocks kick in.
           * Without this override the server attempts to reach Postgres and
           * Google Fonts, both of which are unavailable in CI.
           */
          PLAYWRIGHT: "true",
          HERMETIC_CHAT_PROVIDER: "true",
          /**
           * Expose the public Playwright flag to the dev server so client-side
           * bundles (e.g. Pyodide loader, avatar fallbacks) can disable remote
           * fetches during hermetic runs. The flag mirrors the environment that
           * the CI workflow exports when invoking `pnpm e2e`.
           */
          NEXT_PUBLIC_PLAYWRIGHT: "true",
          /**
           * Surface the finance toggle to both the server and the client build
           * pipeline. This keeps the behaviour identical to the CI workflow
           * where FEATURE_FINANCE/NEXT_PUBLIC_FEATURE_FINANCE are exported and
           * avoids subtle mismatches when the dev server is spawned locally.
           */
          FEATURE_FINANCE: process.env.FEATURE_FINANCE ?? "true",
          NEXT_PUBLIC_FEATURE_FINANCE:
            process.env.NEXT_PUBLIC_FEATURE_FINANCE ??
            process.env.FEATURE_FINANCE ??
            "true",
          PORT: String(resolvedPort),
        },
      }
    : undefined,
});
