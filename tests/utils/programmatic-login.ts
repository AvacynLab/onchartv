/**
 * Attempt to authenticate a regular user by calling NextAuth's credentials
 * callback endpoint directly. Doing so keeps the Playwright warm-up hermetic by
 * avoiding the interactive login form whenever the credentials already exist.
 */
export type CredentialsLoginRequest = {
  get: RequestExecutor;
  post: RequestExecutor;
};

export type RequestExecutor = (
  url: string,
  options?: Record<string, unknown>
) => Promise<ResponseLike>;

export type ResponseHeader = { name: string; value: string };

export type ResponseLike = {
  ok(): boolean;
  status(): number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headers(): ResponseHeader[];
};

export type AutomationCookie = {
  name: string;
  value: string;
  url: string;
  /** Optional domain emitted by the `Set-Cookie` header. */
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type CredentialsLoginOptions = {
  baseURL: string;
  email: string;
  password: string;
  request: CredentialsLoginRequest;
  /**
   * Read the cookies associated with the automation context so we can confirm
   * that a session token has been issued after the credential callback.
   */
  readCookies: () => Promise<Array<{ name: string }>>;
  /**
   * Helper used to determine whether the returned cookies contain the
   * NextAuth session token. The dependency is injected so unit tests can
   * exercise the helper without importing Playwright types.
   */
  hasSessionCookie: (cookies: Array<{ name: string }>) => boolean;
  /**
   * Optional logger invoked when the helper encounters a recoverable failure
   * (for example, a 403 from the callback route). Providing a logger keeps the
   * warm-up diagnostics visible in Playwright traces without failing the run.
   */
  logger?: (message: string, context?: Record<string, unknown>) => void;
  /**
   * Number of attempts to poll for the session cookie after the callback
   * succeeds. Defaults to five exponential backoff attempts.
   */
  cookiePollAttempts?: number;
  /**
   * Optional hook that receives cookies parsed from the `set-cookie` headers
   * returned by the credentials callback. When provided, the helper will
   * forward each cookie with the resolved base URL so callers (for example,
   * Playwright) can add them to their automation context before we poll the
   * session jar.
   */
  applyCookies?: (cookies: AutomationCookie[]) => Promise<void> | void;
};

const DEFAULT_COOKIE_POLL_ATTEMPTS = 5;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function parseSetCookie(cookieHeader: string, baseURL: string): AutomationCookie {
  const segments = cookieHeader.split(";").map((segment) => segment.trim());
  const [nameValue, ...attributes] = segments;

  if (!nameValue) {
    throw new Error("Cookie header missing name/value pair");
  }

  const [rawName, ...rawValueSegments] = nameValue.split("=");
  const name = rawName?.trim();
  const value = rawValueSegments.join("=").trim();

  if (!name || !value) {
    throw new Error("Cookie header missing name or value");
  }

  const { origin } = new URL(baseURL);

  const cookie: AutomationCookie = {
    name,
    value,
    url: origin,
  };

  for (const attribute of attributes) {
    if (!attribute) {
      continue;
    }

    const [rawAttributeName, ...rawAttributeValue] = attribute.split("=");
    const attributeName = rawAttributeName.trim().toLowerCase();
    const attributeValue = rawAttributeValue.join("=").trim();

    switch (attributeName) {
      case "path": {
        cookie.path = attributeValue || "/";
        break;
      }
      case "domain": {
        cookie.domain = attributeValue;
        break;
      }
      case "expires": {
        const expires = Date.parse(attributeValue);
        if (!Number.isNaN(expires)) {
          cookie.expires = Math.floor(expires / 1000);
        }
        break;
      }
      case "max-age": {
        const maxAge = Number.parseInt(attributeValue, 10);
        if (!Number.isNaN(maxAge)) {
          cookie.expires = Math.floor(Date.now() / 1000) + maxAge;
        }
        break;
      }
      case "secure": {
        cookie.secure = true;
        break;
      }
      case "httponly": {
        cookie.httpOnly = true;
        break;
      }
      case "samesite": {
        const normalised = attributeValue.toLowerCase();
        if (normalised === "lax") {
          cookie.sameSite = "Lax";
        } else if (normalised === "strict") {
          cookie.sameSite = "Strict";
        } else if (normalised === "none") {
          cookie.sameSite = "None";
        }
        break;
      }
      default: {
        // Ignore unrecognised attributes (for example `Priority=high`).
        break;
      }
    }
  }

  if (!cookie.path) {
    cookie.path = "/";
  }

  return cookie;
}

export async function loginWithCredentialsCallback(
  options: CredentialsLoginOptions
): Promise<boolean> {
  const {
    baseURL,
    email,
    password,
    request,
    readCookies,
    hasSessionCookie,
    logger,
    cookiePollAttempts = DEFAULT_COOKIE_POLL_ATTEMPTS,
    applyCookies,
  } = options;

  const log = (message: string, context?: Record<string, unknown>) => {
    if (typeof logger === "function") {
      logger(message, context);
    }
  };

  const csrfUrl = new URL("/api/auth/csrf", baseURL).toString();
  const callbackUrl = new URL("/api/auth/callback/credentials", baseURL).toString();

  let csrfToken: string | undefined;

  try {
    const csrfResponse = await request.get(csrfUrl, { timeout: 15_000 });

    if (!csrfResponse.ok()) {
      log("Credentials CSRF fetch failed", {
        status: csrfResponse.status(),
      });
      return false;
    }

    const csrfPayload = (await csrfResponse.json()) as {
      csrfToken?: unknown;
    };

    if (typeof csrfPayload?.csrfToken !== "string" || !csrfPayload.csrfToken) {
      log("Credentials CSRF payload missing token", { payload: csrfPayload });
      return false;
    }

    csrfToken = csrfPayload.csrfToken;
  } catch (error) {
    log("Credentials CSRF fetch threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  try {
    const response = await request.post(`${callbackUrl}?json=true`, {
      form: {
        csrfToken,
        callbackUrl: new URL("/chat", baseURL).toString(),
        json: "true",
        /**
         * Request a JSON payload instead of a redirect so the credentials flow
         * completes even when Playwright does not follow 302 responses. The
         * flag mirrors NextAuth's `redirect: false` behaviour.
         */
        redirect: "false",
        email,
        password,
      },
      /**
       * Prevent Playwright from following the 302 that NextAuth emits even when
       * `redirect=false` is provided. Allowing the redirect caused the helper
       * to await the `/chat` navigation which frequently exceeded the
       * 15&nbsp;s timeout while the dev server was still compiling.  Limiting the
       * redirect chain keeps the callback hermetic and mirrors the behaviour we
       * expect from the JSON response mode.
       */
      maxRedirects: 0,
      timeout: 15_000,
    });

    const status = response.status();

    if (status >= 400) {
      const preview = await response.text().catch(() => "");
      log("Credentials callback returned error status", {
        status,
        preview: preview.slice(0, 200),
      });
      return false;
    }

    if (typeof applyCookies === "function") {
      const headerCookies = response
        .headers()
        .filter((header) => header.name.toLowerCase() === "set-cookie");

      const cookiesToApply: Array<ReturnType<typeof parseSetCookie>> = [];

      for (const header of headerCookies) {
        try {
          const parsed = parseSetCookie(header.value, baseURL);

          cookiesToApply.push(parsed);
        } catch (error) {
          log("Failed to parse set-cookie header", {
            header: header.value,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (cookiesToApply.length > 0) {
        await applyCookies(cookiesToApply);
      }
    }
  } catch (error) {
    log("Credentials callback request threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  for (let attempt = 0; attempt < cookiePollAttempts; attempt += 1) {
    const cookies = await readCookies();
    if (hasSessionCookie(cookies)) {
      return true;
    }

    await delay(50 * 2 ** attempt);
  }

  log("Credentials callback completed but session cookie missing", {
    attempts: cookiePollAttempts,
  });
  return false;
}
