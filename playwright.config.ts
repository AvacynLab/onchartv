import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({
  path: ".env.local",
});

const PORT = process.env.PORT || 3000;
const baseURL = `http://localhost:${PORT}`;

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
  webServer: {
    command: "pnpm dev",
    url: `${baseURL}/ping`,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
});
