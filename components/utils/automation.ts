/**
 * Determine whether the current browser session is driven by an automation
 * harness (e.g. Playwright). The detection intentionally combines multiple
 * signals so hermetic CI runs, local headless checks and developer-driven
 * scenarios that export the Playwright env flag all opt into the same
 * behaviour.
 */
export function isAutomationRuntime(): boolean {
  const toBool = (value?: string) =>
    typeof value === "string" && value.trim() !== "" && value.toLowerCase() !== "false";

  // When rendering on the server we only have access to environment variables,
  // so honour the canonical Playwright flags there. Client bundles, however,
  // should ignore server-only variables such as `PLAYWRIGHT` because Next.js
  // strips them during compilation and our unit tests exercise the jsdom path.
  if (typeof window === "undefined") {
    if (toBool(process.env.NEXT_PUBLIC_PLAYWRIGHT) || toBool(process.env.PLAYWRIGHT) || toBool(process.env.CI_PLAYWRIGHT)) {
      return true;
    }
  } else if (toBool(process.env.NEXT_PUBLIC_PLAYWRIGHT)) {
    return true;
  }

  /**
   * When a browser runtime is available, favour explicit automation signals
   * such as the `navigator.webdriver` flag or the headless markers that
   * Playwright injects into the user agent string. Constrain the heuristics to
   * well-known substrings so regular developer browsers (including jsdom's
   * default agent) are unaffected.
   */
  if (typeof navigator !== "undefined") {
    const automationNavigator = navigator as Navigator & {
      webdriver?: boolean;
      userAgent?: string;
    };

    if (typeof automationNavigator.webdriver === "boolean" && automationNavigator.webdriver) {
      return true;
    }

    /**
     * Playwright-driven browsers advertise explicit headless hints inside the
     * user agent string (for example, "HeadlessChrome" or "Playwright").
     * Rely on those markers when traditional webdriver flags are unavailable so
     * hermetic automation still activates the required fallbacks without
     * impacting regular developer browsers.
     */
    const automationUserAgentHints = [/HeadlessChrome/i, /Playwright/i];
    const userAgent = automationNavigator.userAgent ?? "";

    if (userAgent && automationUserAgentHints.some((pattern) => pattern.test(userAgent))) {
      return true;
    }
  }

  if (typeof window !== "undefined") {
    // Some Playwright harnesses toggle an explicit window flag when
    // bootstrapping helpers. Respect the opt-in so downstream utilities can
    // stay deterministic even when env hints are unavailable.
    const globalWindow = window as typeof window & {
      __PLAYWRIGHT_AUTOMATION__?: boolean;
    };

    if (globalWindow.__PLAYWRIGHT_AUTOMATION__ === true) {
      return true;
    }
  }

  return false;
}

/**
 * Remote avatars rely on external network requests. Disable them whenever we
 * detect an automation harness so Playwright runs remain deterministic and
 * free from flaky image fetches.
 */
export function shouldDisableRemoteAvatars(): boolean {
  return isAutomationRuntime();
}
