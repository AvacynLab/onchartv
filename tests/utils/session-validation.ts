import { hasAuthSessionCookie } from "./auth-session";

import type { Cookie } from "@playwright/test";

/**
 * Shape of the minimal response wrapper returned by Playwright's request API.
 * Isolated here so the validation helper can remain fully typed while still
 * being easy to stub inside the unit tests.
 */
type SessionResponse = {
  ok(): boolean;
  status(): number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

/**
 * Dependencies required to validate whether a Playwright browser context still
 * holds a usable Auth.js session. Calling code provides the cookie reader and
 * the session fetcher so the helper can stay agnostic of the underlying
 * Playwright primitives, which keeps the logic straightforward to unit test.
 */
type SessionValidationOptions = {
  /** Function used to read the cookies currently attached to the context. */
  readCookies: () => Promise<Array<Pick<Cookie, "name">>>;
  /**
   * Callback used to retrieve the JSON payload returned by
   * `/api/auth/session`. The helper requests the endpoint using the provided
   * base URL and aborts early when the response signals an error.
   */
  fetchSession: (url: string) => Promise<SessionResponse>;
  /** Base URL of the running dev server (e.g. `http://localhost:3100`). */
  baseURL: string;
  /** Optional logger surfaced so callers can persist diagnostic metadata. */
  logger?: (message: string, context?: Record<string, unknown>) => void;
};

/**
 * Determine whether the persisted Playwright session cookie is still valid.
 *
 * The helper first checks for the presence of the Auth.js cookie. When the
 * token exists we synchronously query `/api/auth/session` to ensure the server
 * can decrypt the payload with the current secret. Any mismatch (expired token,
 * rotated secret, malformed JSON) results in `false` so the global setup can
 * proactively discard the stale cookie and trigger a fresh login.
 */
export async function hasValidAuthSession({
  readCookies,
  fetchSession,
  baseURL,
  logger,
}: SessionValidationOptions): Promise<boolean> {
  const cookies = await readCookies();

  if (!hasAuthSessionCookie(cookies)) {
    return false;
  }

  let sessionEndpoint: string;

  try {
    /**
     * Guard against invalid environment configuration (such as `baseURL`
     * missing the protocol) so the validation helper fails gracefully instead
     * of throwing and crashing the Playwright global setup.
     */
    sessionEndpoint = new URL("/api/auth/session", baseURL).toString();
  } catch (error) {
    logger?.("Failed to construct session validation endpoint", {
      baseURL,
      cause: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  try {
    const response = await fetchSession(sessionEndpoint);

    if (!response.ok()) {
      const preview = await response
        .text()
        .then((body) => body.slice(0, 200))
        .catch(() => "");

      logger?.("Playwright session validation failed", {
        baseURL,
        status: response.status(),
        preview,
      });

      return false;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      logger?.("Failed to parse /api/auth/session response", {
        baseURL,
        cause: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    if (!payload || typeof payload !== "object") {
      logger?.("Playwright session payload missing user object", {
        baseURL,
        payload,
      });
      return false;
    }

    const user = (payload as { user?: unknown }).user;
    if (!user || typeof user !== "object") {
      logger?.("Playwright session payload missing user object", {
        baseURL,
        payload,
      });
      return false;
    }

    const identifier = (user as { id?: unknown }).id;
    if (typeof identifier !== "string" || identifier.length === 0) {
      logger?.("Playwright session payload missing user identifier", {
        baseURL,
        payload,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger?.("Unexpected error while validating Playwright session", {
      baseURL,
      cause: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
