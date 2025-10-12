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

  if (
    toBool(process.env.NEXT_PUBLIC_PLAYWRIGHT) ||
    toBool(process.env.PLAYWRIGHT) ||
    toBool(process.env.CI_PLAYWRIGHT)
  ) {
    return true;
  }

  if (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { webdriver?: boolean }).webdriver === "boolean" &&
    (navigator as Navigator & { webdriver?: boolean }).webdriver
  ) {
    return true;
  }

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.userAgent === "string" &&
    navigator.userAgent.toLowerCase().includes("headless")
  ) {
    return true;
  }

  if (typeof window !== "undefined") {
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
