import fs from "node:fs";
import path from "node:path";

import type { BrowserContext, Cookie } from "@playwright/test";

/**
 * Location on disk where we persist the authentication cookie captured during
 * Playwright runs. Storing the cookie separately from the storage state keeps
 * the session available even when individual tests clear their browser
 * context, which previously forced the credentials suite to re-authenticate via
 * the flaky login form.
 */
const PLAYWRIGHT_AUTH_DIR = path.resolve(__dirname, "../.auth");
const SESSION_COOKIE_PATH = path.join(
  PLAYWRIGHT_AUTH_DIR,
  "playwright-session-cookie.json",
);

type PersistedSessionPayload = {
  cookies: Cookie[];
};

function ensureAuthDirectory() {
  fs.mkdirSync(PLAYWRIGHT_AUTH_DIR, { recursive: true });
}

/**
 * Persist the current authentication cookies to disk so other tests (or later
 * retries) can restore the logged-in session without resubmitting credentials.
 */
export async function persistSessionCookies(
  context: BrowserContext,
): Promise<void> {
  const cookies = await context.cookies();

  const sessionCookies = cookies.filter((cookie) =>
    cookie.name.includes("authjs.session-token"),
  );

  if (sessionCookies.length === 0) {
    return;
  }

  ensureAuthDirectory();

  const payload: PersistedSessionPayload = {
    cookies: sessionCookies,
  };

  fs.writeFileSync(SESSION_COOKIE_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

/**
 * Determine whether a persisted session cookie exists on disk.
 */
export function hasPersistedSessionCookies(): boolean {
  return fs.existsSync(SESSION_COOKIE_PATH);
}

/**
 * Remove the persisted session cookie. Useful when tests explicitly log out
 * and wish to ensure the cached credentials are no longer reused.
 */
export function clearPersistedSessionCookies(): void {
  if (!fs.existsSync(SESSION_COOKIE_PATH)) {
    return;
  }

  fs.rmSync(SESSION_COOKIE_PATH);
}

function normaliseCookiesForBaseUrl(cookies: Cookie[], baseURL: string) {
  return cookies.map((cookie) => {
    if (cookie.domain || cookie.path) {
      return cookie;
    }

    return {
      ...cookie,
      url: baseURL,
    };
  });
}

/**
 * Restore the persisted session cookie on the provided browser context. The
 * helper returns `true` when a cookie was applied so callers can decide whether
 * additional authentication work is required.
 */
export async function restoreSessionCookies(
  context: BrowserContext,
  baseURL: string,
): Promise<boolean> {
  if (!fs.existsSync(SESSION_COOKIE_PATH)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(SESSION_COOKIE_PATH, "utf-8");
    const payload = JSON.parse(raw) as PersistedSessionPayload | null;

    if (!payload || !Array.isArray(payload.cookies) || payload.cookies.length === 0) {
      return false;
    }

    const cookies = normaliseCookiesForBaseUrl(payload.cookies, baseURL);
    await context.addCookies(cookies);

    return true;
  } catch (error) {
    console.warn("Failed to restore persisted Playwright session cookie", error);
    return false;
  }
}

/**
 * Expose the persisted session cookie path for unit tests. Keeping the helper
 * out of the default export avoids accidental reliance within production code.
 */
export function __getSessionCookiePathForTests(): string {
  return SESSION_COOKIE_PATH;
}

