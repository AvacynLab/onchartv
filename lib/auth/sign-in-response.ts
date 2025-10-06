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
type SignInResultOptions = {
  baseUrl?: string;
};

const resolveBaseUrl = () =>
  process.env.NEXTAUTH_URL ?? "http://localhost:3000";

const loginRedirectsTo = (
  value: string | null | undefined,
  baseUrl: string
) => {
  if (!value) {
    return false;
  }

  try {
    const target = new URL(value, baseUrl);
    return target.pathname.startsWith("/login");
  } catch {
    return value.startsWith("/login");
  }
};

const extractResultUrl = (result: NormalisedSignInResult) => {
  if (typeof result === "string") {
    return result;
  }

  if (result instanceof Response) {
    return result.headers.get("Location");
  }

  if (typeof result === "object" && result !== null && "url" in result) {
    const { url } = result as { url?: unknown };
    return typeof url === "string" ? url : undefined;
  }

  return undefined;
};

export function didSignInSucceed(
  result: NormalisedSignInResult,
  options: SignInResultOptions = {}
): boolean {
  const baseUrl = options.baseUrl ?? resolveBaseUrl();
  if (typeof result === "undefined") {
    /**
     * NextAuth returns `undefined` when a credentials-based sign-in succeeds
     * without issuing an explicit redirect. Treat this as a success so the UI
     * can surface the happy-path toasts and proceed with the session refresh.
     */
    return true;
  }

  if (typeof result === "string") {
    return !loginRedirectsTo(result, baseUrl);
  }

  if (result instanceof Response) {
    if (!result.ok) {
      return false;
    }

    if (loginRedirectsTo(result.headers.get("Location"), baseUrl)) {
      return false;
    }

    return true;
  }

  if (typeof result === "object" && result !== null && "ok" in result) {
    const { ok } = result as { ok?: unknown };
    if (loginRedirectsTo(extractResultUrl(result), baseUrl)) {
      return false;
    }

    return ok === true;
  }

  if (loginRedirectsTo(extractResultUrl(result), baseUrl)) {
    return false;
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
