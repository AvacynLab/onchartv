import { generateDummyPassword } from "./db/utils";

export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
/**
 * Treat standard test runners as a valid "test" environment alongside the
 * Playwright harness so unit suites can interact with the in-memory database
 * helpers without depending on Playwright-specific flags.
 */
export const isTestEnvironment = Boolean(
  process.env.NODE_ENV === "test" ||
    process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

export const DUMMY_PASSWORD = generateDummyPassword();
