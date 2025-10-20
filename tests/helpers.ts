import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from "@playwright/test";
import { generateId } from "ai";
import { getUnixTime } from "date-fns";
import { chatModels } from "@/lib/ai/models";
import { ChatPage } from "./pages/chat";

/**
 * Human-readable fragment rendered by the Next.js client-side error overlay.
 * We assert on a substring instead of the full message so the helper remains
 * resilient to copy tweaks while still detecting the overlay reliably.
 */
const NEXT_ERROR_OVERLAY_FRAGMENT =
  "Application error: a client-side exception has occurred";

export type UserContext = {
  context: BrowserContext;
  page: Page;
  request: APIRequestContext;
};

/**
 * Attempt to bootstrap a new Playwright context from a previously persisted
 * storage state. When the saved session matches the expected user email we can
 * reuse it instead of navigating through the authentication forms again – a
 * significant time saver for the multi-user reasoning and share suites.
 */
export async function tryRestoreSessionFromStorage({
  baseURL,
  browser,
  expectedEmail,
  storageStatePath,
}: {
  baseURL: string;
  browser: Browser;
  expectedEmail: string;
  storageStatePath: string;
}): Promise<UserContext | null> {
  if (!fs.existsSync(storageStatePath)) {
    return null;
  }

  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({ storageState: storageStatePath });

    const sessionResponse = await context.request.get(
      `${baseURL}/api/auth/session`
    );

    if (!sessionResponse.ok()) {
      throw new Error("Stored session response was not successful");
    }

    const session = (await sessionResponse.json()) as {
      user?: { email?: string | null };
    } | null;

    if (session?.user?.email !== expectedEmail) {
      throw new Error(
        `Stored session belongs to "${session?.user?.email ?? "unknown"}"`
      );
    }

    const page = await context.newPage();

    return {
      context,
      page,
      request: context.request,
    } satisfies UserContext;
  } catch (error) {
    await context?.close();
    console.warn(
      "Failed to reuse stored Playwright session, falling back to UI auth",
      error
    );
    return null;
  }
}

/**
 * Maximum amount of time we are willing to wait for automation-focused auth
 * calls to settle. The generous window keeps hermetic Playwright runs stable
 * during slow cold starts without masking legitimate hangs in the stack.
 */
const AUTH_SESSION_WAIT_TIMEOUT_MS = 45_000;

/**
 * Perform a credentials sign-in entirely via the NextAuth API. Driving the
 * request layer instead of the UI removes the dependency on the `/login`
 * component hydrating in time – the main source of the flaky `toBeEditable`
 * timeouts we were observing on CI. The helper verifies the resulting session
 * by polling the `/api/auth/session` endpoint before returning control to the
 * caller.
 */
export async function signInPlaywrightUser({
  baseURL,
  context,
  email,
  password,
  sessionPollIntervalMs = 250,
  sessionPollTimeoutMs = AUTH_SESSION_WAIT_TIMEOUT_MS,
}: {
  baseURL: string;
  context: BrowserContext;
  email: string;
  password: string;
  sessionPollIntervalMs?: number;
  sessionPollTimeoutMs?: number;
}) {
  const csrfResponse = await context.request.get(`${baseURL}/api/auth/csrf`);

  if (!csrfResponse.ok()) {
    throw new Error(
      `Failed to retrieve CSRF token: ${csrfResponse.status()} ${await csrfResponse.text()}`
    );
  }

  const csrfPayload = (await csrfResponse.json()) as {
    csrfToken?: string | null;
  } | null;

  const csrfToken = csrfPayload?.csrfToken;

  if (!csrfToken) {
    throw new Error("Playwright auth helper received an empty CSRF token");
  }

  const maxSignInAttempts = 3;
  let signInResponse: Awaited<ReturnType<typeof context.request.post>> | null =
    null;
  let lastSignInError: unknown = null;

  for (let attempt = 1; attempt <= maxSignInAttempts; attempt += 1) {
    try {
      const response = await context.request.post(
        `${baseURL}/api/auth/callback/credentials`,
        {
          form: {
            csrfToken,
            email,
            password,
            callbackUrl: `${baseURL}/`,
          },
        }
      );

      const status = response.status();

      if (status >= 400) {
        lastSignInError = new Error(
          `status ${status}: ${await response.text()}`
        );
      } else {
        signInResponse = response;
        break;
      }
    } catch (error) {
      lastSignInError = error;
      signInResponse = null;
    }

    if (attempt < maxSignInAttempts) {
      const backoffMs = attempt * 250;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  if (!signInResponse) {
    const diagnostic =
      lastSignInError instanceof Error
        ? lastSignInError.message
        : String(lastSignInError ?? "Unknown error");

    throw new Error(
      `Playwright credentials sign-in failed after ${maxSignInAttempts} attempts: ${diagnostic}`
    );
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < sessionPollTimeoutMs) {
    const sessionResponse = await context.request.get(
      `${baseURL}/api/auth/session`
    );

    if (sessionResponse.ok()) {
      const session = (await sessionResponse.json()) as
        | { user?: { email?: string | null } | null }
        | null;

      if (session?.user?.email === email) {
        return;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, sessionPollIntervalMs));
  }

  throw new Error(
    "Timed out waiting for the Playwright credentials session to become active"
  );
}

/**
 * Bootstrap a fully authenticated Playwright context backed by a deterministic
 * test user. Optional chat model preferences can be provided so specialised
 * suites (for example reasoning journeys) can preload their desired provider
 * without relying on brittle UI interactions during setup.
 */
export async function createAuthenticatedContext({
  browser,
  name,
  preferredChatModelId,
}: {
  browser: Browser;
  name: string;
  preferredChatModelId?: string;
}): Promise<UserContext> {
  const directory = path.join(__dirname, "../playwright/.sessions");

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const storageFile = path.join(directory, `${name}.json`);
  const credentialsFile = path.join(directory, `${name}.credentials.json`);

  const email = `test-${name}@playwright.com`;
  const baseURL =
    process.env.PLAYWRIGHT_TEST_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3100}`;

  const restoredSession = await tryRestoreSessionFromStorage({
    baseURL,
    browser,
    expectedEmail: email,
    storageStatePath: storageFile,
  });

  if (restoredSession) {
    return restoredSession;
  }

  let password: string | null = null;

  if (fs.existsSync(credentialsFile)) {
    try {
      const raw = fs.readFileSync(credentialsFile, "utf-8");
      const parsed = JSON.parse(raw) as { password?: string } | null;
      if (parsed?.password) {
        password = parsed.password;
      }
    } catch (error) {
      console.warn(
        "Failed to parse cached Playwright credentials, generating a fresh password",
        error
      );
    }
  }

  if (!password) {
    /**
     * Persist the generated password on disk so reusing the same logical user
     * across retries (share/read-only scenarios) does not leave the account
     * stuck with an unknown secret.
     */
    password = generateId();
    const payload = JSON.stringify({ email, password }, null, 2);
    fs.writeFileSync(credentialsFile, payload);
  }

  const resolvedPassword = password;

  const context = await browser.newContext();

  /**
   * Provision the deterministic Playwright account via the dedicated testing
   * endpoint so we can jump straight to the login form regardless of how long
   * the registration UI takes to hydrate under cold starts.
   */
  /**
   * Registering via the testing endpoint occasionally races with the server's
   * warmup work and can yield transient socket resets. Retry a few times with a
   * short backoff so hermetic suites no longer fail on the very first ECONNRESET
   * observed during cold starts.
   */
  const maxRegisterAttempts = 3;
  let ensureUserResponse: Awaited<ReturnType<typeof context.request.post>> | null = null;
  let lastRegisterError: unknown = null;

  for (let attempt = 1; attempt <= maxRegisterAttempts; attempt += 1) {
    try {
      ensureUserResponse = await context.request.post(
        `${baseURL}/api/tests/auth/register`,
        {
          data: { email, password: resolvedPassword },
        }
      );

      if (ensureUserResponse.ok()) {
        break;
      }

      lastRegisterError = new Error(
        `status ${ensureUserResponse.status()}: ${await ensureUserResponse.text()}`
      );
    } catch (error) {
      lastRegisterError = error;
      ensureUserResponse = null;
    }

    if (attempt < maxRegisterAttempts) {
      const backoffMs = attempt * 250;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  if (!ensureUserResponse || !ensureUserResponse.ok()) {
    const diagnostic =
      lastRegisterError instanceof Error
        ? lastRegisterError.message
        : String(lastRegisterError ?? "Unknown error");

    throw new Error(
      `Failed to provision Playwright test user after ${maxRegisterAttempts} attempts: ${diagnostic}`
    );
  }

  await signInPlaywrightUser({
    baseURL,
    context,
    email,
    password: resolvedPassword,
  });

  /**
   * Store the reasoning chat model preference directly via cookies so the
   * Playwright bootstrap no longer depends on the Radix-driven selector menu.
   * Recent upgrades to Radix changed the menu item roles which made the UI
   * interaction brittle and caused the hermetic suites to fail when the items
   * rendered in a slightly different structure. Persisting the cookie mirrors
   * what the server action would emit and keeps the preferred model stable
   * across warm and cold starts alike.
   */
  const preferredModel = preferredChatModelId
    ? chatModels.find((model) => model.id === preferredChatModelId)
    : null;

  if (preferredChatModelId && !preferredModel) {
    throw new Error(
      `Unable to locate the preferred chat model: ${preferredChatModelId}`
    );
  }

  if (preferredModel) {
    const cookieUrl = new URL(baseURL);

    await context.addCookies([
      {
        name: "chat-model",
        value: preferredModel.id,
        url: cookieUrl.origin,
      },
    ]);
  }

  const page = await context.newPage();
  const chatPage = new ChatPage(page);
  await chatPage.createNewChat();

  const composerInput = page.getByPlaceholder("Send a message...");

  /**
   * Wait for the chat composer to hydrate before verifying the selected model.
   * The textarea renders earlier than the selector so this gives us a reliable
   * signal that the client bundle has streamed in.
   */
  await expect(composerInput).toBeVisible({ timeout: 60_000 });

  if (preferredModel) {
    const selectedModelName = await chatPage
      .getSelectedModel()
      .then((value) => value.trim());

    if (selectedModelName !== preferredModel.name) {
      /**
       * Fallback to the interactive selector only when the cookie approach
       * fails (for example when the component renames the label). This keeps
       * the hermetic bootstrap resilient without masking legitimate
       * regressions in the selector itself.
       */
      await chatPage.chooseModelFromSelector(preferredModel.id);
      await expect(chatPage.getSelectedModel()).resolves.toEqual(
        preferredModel.name
      );
    }
  }

  await page.waitForTimeout(1000);
  await context.storageState({ path: storageFile });
  await page.close();
  await context.close();

  const newContext = await browser.newContext({ storageState: storageFile });
  const newPage = await newContext.newPage();

  return {
    context: newContext,
    page: newPage,
    request: newContext.request,
  };
}

export function generateRandomTestUser() {
  /**
   * Combine a timestamp and UUID to avoid cross-test collisions when multiple
   * suites provision users within the same second. Playwright previously reused
   * the second-based slug which caused the registration toast assertion to
   * flake as the backend rejected duplicate emails.
   */
  const timestamp = getUnixTime(new Date());
  const email = `test-${timestamp}-${randomUUID()}@playwright.com`;
  const password = generateId();

  return {
    email,
    password,
  };
}

/**
 * Assert that the Next.js client-side exception overlay never appeared during
 * the current test. The overlay is injected into the page when an unhandled
 * client error bubbles to the top-level runtime; ensuring the fragment remains
 * absent gives us early signal that the hardened components and error
 * boundaries are working as expected.
 */
export async function expectNoApplicationErrorOverlay(page: Page) {
  const overlayLocator = page.getByText(NEXT_ERROR_OVERLAY_FRAGMENT, {
    exact: false,
  });

  try {
    await expect(overlayLocator).toHaveCount(0);
  } catch (error) {
    /**
     * Capture a screenshot to help diagnose which component triggered the
     * overlay. The Playwright artifact directory mirrors the structure used by
     * the other helpers so CI can surface the images alongside trace archives.
     */
    const overlayArtifactsDir = path.join(
      process.cwd(),
      "playwright-results",
      "overlays"
    );

    fs.mkdirSync(overlayArtifactsDir, { recursive: true });

    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-");
    const screenshotPath = path.join(
      overlayArtifactsDir,
      `overlay-${timestamp}.png`
    );

    await page.screenshot({
      fullPage: true,
      path: screenshotPath,
    });

    const relativePath = path.relative(process.cwd(), screenshotPath);
    const normalizedRelativePath = relativePath.split(path.sep).join("/");

    if (error instanceof Error) {
      error.message = `${error.message}\nNext.js overlay screenshot saved to: ${normalizedRelativePath}`;
      throw error;
    }

    throw new Error(
      `Next.js overlay detected. Screenshot saved to: ${normalizedRelativePath}`
    );
  }
}
