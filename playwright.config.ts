import path from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

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

const PORT = process.env.PORT || 3000;
const baseURL = `http://localhost:${PORT}`;
const shouldStartWebServer = process.env.PLAYWRIGHT_MANUAL_SERVER !== "true";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 8,
  reporter: "html",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
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
      testMatch: /e2e\/.*\.test\.ts/,
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
        command: "pnpm dev",
        url: `${baseURL}/ping`,
        timeout: 120 * 1000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
});
