import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  expect,
  test as setup,
  type Browser,
  type BrowserContext,
  type Page,
  type APIResponse,
} from "@playwright/test";

import { hasAuthSessionCookie } from "../utils/auth-session";
import { persistSessionCookies } from "../utils/session-persistence";
import { waitForServerReady } from "../utils/server-health";
import { warmupNextRoutes } from "../utils/server-warmup";
import {
  loginWithCredentialsCallback,
  type ResponseLike,
} from "../utils/programmatic-login";
import { withStepTiming } from "../utils/timing";

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

  const toResponseLike = async (
    executor: Promise<APIResponse>
  ): Promise<ResponseLike> => {
    const response = await executor;
    return {
      ok: () => response.ok(),
      status: () => response.status(),
      json: () => response.json(),
      text: () => response.text(),
      headers: () =>
        response
          .headersArray()
          .map(({ name, value }) => ({ name, value })),
    };
  };

  /**
   * Registration already performs a credentials sign-in via the server
   * action. When the session cookie exists we can skip the manual login to
   * avoid hitting the `/login` form and re-triggering a flurry of
   * `GET /api/auth/session` requests during hermetic runs.
   */
  if (await hasExistingSession(context)) {
    return;
  }

  /**
   * Attempt the credential callback directly before falling back to the
   * browser-driven flow. When it succeeds the warm-up can skip rendering the
   * `/login` form entirely, which keeps hermetic runs fast and sidesteps the
   * flaky redirect we observed when the dev server was still compiling.
   */
  const programmaticLoginSucceeded = await loginWithCredentialsCallback({
    baseURL,
    email: creds.email,
    password: creds.password,
    request: {
      get: (url, options) =>
        toResponseLike(context.request.get(url, options)),
      post: (url, options) =>
        toResponseLike(context.request.post(url, options)),
    },
    readCookies: () => context.cookies(),
    hasSessionCookie: hasAuthSessionCookie,
    logger: (message, contextDetails) => {
      console.warn(message, contextDetails);
    },
    applyCookies: async (cookies) => {
      /**
       * Replay the cookies emitted by the credential callback into the
       * Playwright browser context. Doing so mirrors the network stack that the
       * user-facing login flow would exercise and keeps the warm-up compatible
       * with strict HttpOnly/SameSite policies enforced by NextAuth.
       */
      await context.addCookies(
        cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          url: cookie.url,
          path: cookie.path,
          expires: cookie.expires,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
        }))
      );
    },
  });

  if (programmaticLoginSucceeded) {
    return;
  }

  await page.goto(`${baseURL}/login`);

  await expect(page.getByPlaceholder("user@acme.com")).toBeVisible({
    /**
     * Verifying the form fields helps us fail fast when the login route
     * regresses (for example, due to a renamed label) instead of timing out
     * later while typing into a missing locator.
     */
    timeout: 15_000,
  });
  await expect(page.getByLabel("Password")).toBeVisible({ timeout: 15_000 });

  if (page.url().endsWith("/login")) {
    await page.getByPlaceholder("user@acme.com").fill(creds.email);
    await page.getByLabel("Password").fill(creds.password);

    const signInButton = page.getByRole("button", { name: "Sign in" });
    await expect(signInButton).toBeVisible({ timeout: 15_000 });

    const waitForRedirect = page
      .waitForURL(
        (url) => !url.pathname.endsWith("/login"),
        { timeout: 30_000, waitUntil: "commit" }
      )
      .catch((error) => {
        /**
         * Cold starts can still leave the browser on `/login` while Turbopack
         * compiles the post-auth redirect. Mirror the register flow by logging
         * (instead of failing) so the subsequent session check can confirm the
         * credentials worked before we proceed to `/chat`.
         */
        console.warn("Playwright login redirect timed out", { cause: error });
        return null;
      });

    await Promise.all([waitForRedirect, signInButton.click()]);

    await expect
      .poll(async () => hasExistingSession(context), { timeout: 15_000 })
      .toBeTruthy();
  }
}

async function ensureChatSurface(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/chat`, { waitUntil: "domcontentloaded" });

  const currentUrl = new URL(page.url());
  if (currentUrl.pathname.startsWith("/login")) {
    throw new Error(
      "Playwright auth setup navigated to /login after provisioning credentials. " +
        "Double-check the registration/login selectors and ensure session cookies are persisted."
    );
  }

  await expect(page.getByTestId("multimodal-input")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 15_000 });
}

async function ensureAutomationAccount(
  baseURL: string,
  credentials: { email: string; password: string }
) {
  const registrationUrl = new URL("/api/tests/auth/register", baseURL);

  try {
    const response = await fetch(registrationUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      const preview = await response.text().catch(() => "");
      throw new Error(
        `Failed to provision Playwright credentials (${response.status}): ${preview.slice(0, 200)}`
      );
    }
  } catch (error) {
    throw new Error(
      "Unable to ensure the Playwright automation account exists before logging in",
      error instanceof Error ? { cause: error } : undefined
    );
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

  await withStepTiming({
    label: "wait for server readiness probe",
    thresholdMs: 15_000,
    task: () => waitForServerReady(baseURL),
  });

  /**
   * Warm the most common routes before Playwright begins interacting with the
   * UI. Turbopack compiles pages on first access which previously caused
   * `ERR_EMPTY_RESPONSE` aborts when the SPA navigated mid-compilation. The
   * warm-up keeps the development server responsive for the upcoming auth and
   * chat flows.
   */
  await withStepTiming({
    label: "warm Next.js routes",
    thresholdMs: 90_000,
    task: () =>
      warmupNextRoutes(baseURL, {
        /**
         * Warm the chat dashboard and auth forms. Skipping the marketing homepage
         * keeps cold starts under the 240s Playwright budget now that logins
         * redirect straight to `/chat`.
         */
        routes: [
          "/login",
          "/chat",
          "/api/history?limit=1",
          "/api/tests/auth/register",
        ],
      }),
  });

  const reusedSession = await withStepTiming({
    label: "reuse stored Playwright session",
    thresholdMs: 5_000,
    task: () => reuseStoredSession(browser, baseURL),
  });

  if (reusedSession) {
    return;
  }

  const credentials = loadCredentials();
  await withStepTiming({
    label: "ensure automation account exists",
    thresholdMs: 10_000,
    task: () => ensureAutomationAccount(baseURL, credentials),
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await withStepTiming({
      label: "authenticate through login form",
      thresholdMs: 60_000,
      task: () => ensureLoggedIn(page, baseURL, credentials),
    });

    await withStepTiming({
      label: "load chat surface",
      thresholdMs: 30_000,
      task: () => ensureChatSurface(page, baseURL),
    });

    await withStepTiming({
      label: "persist Playwright storage state",
      thresholdMs: 5_000,
      task: async () => {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        await context.storageState({ path: STATE_PATH });
        await persistSessionCookies(context);
      },
    });

    // Double-check that the storage snapshot landed on disk so subsequent
    // workers can reuse the authenticated session without re-registering.
    expect(fs.existsSync(STATE_PATH)).toBe(true);
  } finally {
    await context.close();
  }
});
