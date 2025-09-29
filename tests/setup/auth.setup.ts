import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  expect,
  test as setup,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { hasAuthSessionCookie } from "../utils/auth-session";
import { waitForServerReady } from "../utils/server-health";
import { warmupNextRoutes } from "../utils/server-warmup";

const AUTH_DIR = path.resolve(__dirname, "../.auth");
const STATE_PATH = path.join(AUTH_DIR, "state.json");
const CREDENTIALS_PATH = path.join(AUTH_DIR, "user.json");

/**
 * Load persisted Playwright credentials or generate a deterministic fallback.
 *
 * Storing the generated credentials on disk allows subsequent setup runs to
 * reuse the same account and, together with the storage-state reuse logic,
 * avoids hitting the registration flow unless the underlying session expired.
 */
function loadCredentials() {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { email: string; password: string };
    if (parsed.email && parsed.password) {
      return parsed;
    }
  }

  const email = process.env.E2E_USER_EMAIL ?? `e2e-${Date.now()}@playwright.com`;
  const password =
    process.env.E2E_USER_PASSWORD ?? `E2e-${randomBytes(6).toString("hex")}!`;

  const creds = { email, password };
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
  return creds;
}

/**
 * Ensure we hold a valid credentials session by visiting the login form and
 * submitting the provided email/password pair. The helper is safe to call even
 * when the account already exists, making it ideal for retrying after a failed
 * registration attempt.
 */
async function ensureLoggedIn(
  page: Page,
  baseURL: string,
  creds: { email: string; password: string }
) {
  const context = page.context();

  /**
   * Registration already performs a credentials sign-in via the server
   * action. When the session cookie exists we can skip the manual login to
   * avoid hitting the `/login` form and re-triggering a flurry of
   * `GET /api/auth/session` requests during hermetic runs.
   */
  if (await hasExistingSession(context)) {
    return;
  }

  await page.goto(`${baseURL}/login`);

  if (page.url().endsWith("/login")) {
    await page.getByPlaceholder("user@acme.com").fill(creds.email);
    await page.getByLabel("Password").fill(creds.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect
      .poll(async () => hasExistingSession(context), { timeout: 15_000 })
      .toBeTruthy();
  }
}

async function hasExistingSession(context: BrowserContext): Promise<boolean> {
  return hasAuthSessionCookie(await context.cookies());
}

const getBaseURL = () =>
  process.env.PLAYWRIGHT_TEST_BASE_URL ??
  `http://localhost:${process.env.PORT ?? 3100}`;

/**
 * Reuse the stored Playwright storage state when the session cookie is still
 * valid. Refreshing the file on disk ensures the expiration moves forward so
 * long test runs do not unexpectedly invalidate the cached login.
 */
async function reuseStoredSession(browser: Browser, baseURL: string) {
  if (!fs.existsSync(STATE_PATH)) {
    return false;
  }

  const context = await browser.newContext({ storageState: STATE_PATH });

  try {
    const sessionResponse = await context.request.get(
      `${baseURL}/api/auth/session`
    );

    if (!sessionResponse.ok()) {
      return false;
    }

    const session: unknown = await sessionResponse.json();

    if (
      !session ||
      typeof session !== "object" ||
      !("user" in session) ||
      !session.user ||
      typeof session.user !== "object" ||
      !("id" in session.user)
    ) {
      return false;
    }

    await context.storageState({ path: STATE_PATH });
    return true;
  } catch {
    return false;
  } finally {
    await context.close();
  }
}

setup("authenticate", async ({ browser }) => {
  const baseURL = getBaseURL();

  await waitForServerReady(baseURL);

  /**
   * Warm the most common routes before Playwright begins interacting with the
   * UI. Turbopack compiles pages on first access which previously caused
   * `ERR_EMPTY_RESPONSE` aborts when the SPA navigated mid-compilation. The
   * warm-up keeps the development server responsive for the upcoming auth and
   * chat flows.
   */
  await warmupNextRoutes(baseURL);

  if (await reuseStoredSession(browser, baseURL)) {
    return;
  }

  const credentials = loadCredentials();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${baseURL}/register`);
    await page.getByPlaceholder("user@acme.com").fill(credentials.email);
    await page.getByLabel("Password").fill(credentials.password);
    await page.getByRole("button", { name: "Sign Up" }).click();

    await expect(page.getByTestId("toast")).toContainText("Account");
    await ensureLoggedIn(page, baseURL, credentials);

    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await context.storageState({ path: STATE_PATH });
  } finally {
    await context.close();
  }
});
