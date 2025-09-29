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
  return cookies.some(({ name }) => name.includes("authjs.session-token"));
}
