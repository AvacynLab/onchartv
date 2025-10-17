/**
 * Determine whether the provided URL targets the chat surface. The helper is
 * intentionally resilient so the Playwright setup can poll for the redirect
 * without throwing when encountering transient values such as `about:blank` or
 * an empty string.
 */
export function isChatPathname(candidateUrl: string): boolean {
  try {
    const { pathname } = new URL(candidateUrl);

    if (pathname === "/chat") {
      return true;
    }

    return pathname.startsWith("/chat/");
  } catch (error) {
    // Keep the helper tolerant of malformed URLs so callers can retry until the
    // Next.js router settles on the expected destination.
    return false;
  }
}
