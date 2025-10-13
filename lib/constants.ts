import { generateDummyPassword } from "./db/utils";

/**
 * Deterministic onboarding prompt surfaced across the application. The value
 * underpins Playwright journeys that click the first suggested action, so it is
 * centralised here to keep the UI and the test harness in sync.
 */
export const DEFAULT_ONBOARDING_SUGGESTION =
  "What are the advantages of using Next.js?";

export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";

/**
 * Determine whether the current process should execute the hermetic code paths
 * that back the Playwright and Vitest suites. The value must be resolved at the
 * time of each call because a number of unit tests toggle the `PLAYWRIGHT`
 * environment variable after modules have been imported. Keeping the check
 * dynamic prevents those suites from observing stale values cached at module
 * initialisation time.
 */
export function isTestEnvironment(): boolean {
  return Boolean(
    process.env.PLAYWRIGHT_TEST_BASE_URL ||
      process.env.PLAYWRIGHT ||
      process.env.CI_PLAYWRIGHT
  );
}

export const DUMMY_PASSWORD = generateDummyPassword();
