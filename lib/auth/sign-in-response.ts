/**
 * Helper utilities shared by the authentication server actions to interpret
 * the different result shapes returned by `next-auth`'s credentials provider.
 * Isolating them in a standalone module keeps the parsing logic testable
 * without importing the server-only NextAuth runtime during unit tests.
 */

export type NormalisedSignInResult =
  | string
  | Response
  | { ok?: unknown; url?: unknown }
  | undefined
  | null;

/**
 * Determine whether the credentials provider reported a successful sign-in.
 * The helper understands the various return values surfaced by NextAuth
 * depending on redirects and environment (undefined, string URLs, Response
 * objects, or `{ ok: boolean }` objects) and normalises them into a boolean
 * flag that the UI can consume.
 */
export function didSignInSucceed(result: NormalisedSignInResult): boolean {
  if (typeof result === "undefined") {
    /**
     * NextAuth returns `undefined` when a credentials-based sign-in succeeds
     * without issuing an explicit redirect. Treat this as a success so the UI
     * can surface the happy-path toasts and proceed with the session refresh.
     */
    return true;
  }

  if (typeof result === "string") {
    return true;
  }

  if (result instanceof Response) {
    return result.ok;
  }

  if (typeof result === "object" && result !== null && "ok" in result) {
    const { ok } = result as { ok?: unknown };
    return ok === true;
  }

  return false;
}

/**
 * Extract a safe redirect path from the credentials provider response so the
 * login/register actions can forward users to the dashboard without
 * hard-coding absolute URLs.
 */
export function extractRedirectPath(
  result: NormalisedSignInResult,
  {
    baseUrl,
  }: {
    baseUrl: string;
  }
): string | undefined {
  const normalise = (value: string | null | undefined) => {
    if (!value) {
      return undefined;
    }

    try {
      const path = new URL(value, baseUrl).pathname;

      // Ignore redirects back to the login page so successful submissions
      // always land on the chat dashboard.
      return path.startsWith("/login") ? undefined : path;
    } catch {
      if (!value.startsWith("/")) {
        return undefined;
      }

      // Ignore redirects back to the login page so successful submissions
      // always land on the chat dashboard.
      return value.startsWith("/login") ? undefined : value;
    }
  };

  if (typeof result === "string") {
    return normalise(result);
  }

  if (result instanceof Response) {
    return normalise(result.headers.get("Location"));
  }

  if (typeof result === "object" && result !== null && "url" in result) {
    const { url } = result as { url?: unknown };
    if (typeof url === "string") {
      return normalise(url);
    }
  }

  return undefined;
}
