/**
 * Candidate substrings used by Auth.js / NextAuth when emitting session
 * cookies. The name depends on the major version as well as whether the cookie
 * is marked `__Secure-`, so we match on substrings to keep the detection
 * resilient across environments.
 */
export const AUTH_SESSION_COOKIE_IDENTIFIERS = [
  "authjs.session-token",
  "next-auth.session-token",
] as const;

/**
 * Tell whether the provided cookie name matches one of the Auth.js session
 * tokens. Exposed separately so persistence utilities can reuse the same
 * detection logic without duplicating the identifier list.
 */
export function isAuthSessionCookieName(name: string): boolean {
  return AUTH_SESSION_COOKIE_IDENTIFIERS.some((identifier) =>
    name.includes(identifier)
  );
}

/**
 * Determine whether a list of cookies contains the Auth.js session token.
 *
 * Playwright's registration setup performs a full credentials sign-in, which
 * issues a cookie such as `authjs.session-token` (or similar) when successful.
 * The helper keeps the cookie check isolated so we can unit test the logic
 * without requiring a browser context.
 */
export function hasAuthSessionCookie(
  cookies: Array<Pick<import("@playwright/test").Cookie, "name">>
): boolean {
  return cookies.some(({ name }) => isAuthSessionCookieName(name));
}
