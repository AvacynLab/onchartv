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

  // Avoid brittle userAgent heuristics. JSDOM advertises "HeadlessChrome" even
  // in regular unit tests, which previously tricked the detector into thinking
  // automation was active when a human-driven browser would behave normally.
  if (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { webdriver?: boolean }).webdriver === "boolean" &&
    (navigator as Navigator & { webdriver?: boolean }).webdriver
  ) {
    return true;
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
