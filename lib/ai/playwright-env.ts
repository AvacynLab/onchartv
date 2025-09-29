/**
 * Utilities that detect whether the application is running under the
 * Playwright end-to-end test harness. Centralising the logic keeps the
 * heuristics in sync across server and client helpers.
 */
export function isPlaywrightLikeEnvironment(env: NodeJS.ProcessEnv): boolean {
  if (!env) {
    return false;
  }

  if (env.PLAYWRIGHT && env.PLAYWRIGHT.toLowerCase() !== "false") {
    return true;
  }

  if (env.CI_PLAYWRIGHT && env.CI_PLAYWRIGHT.toLowerCase() !== "false") {
    return true;
  }

  if (env.PLAYWRIGHT_TEST_BASE_URL) {
    return true;
  }

  if (env.NEXT_PUBLIC_PLAYWRIGHT === "true") {
    return true;
  }

  return false;
}
