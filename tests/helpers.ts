import fs from "node:fs";
import path from "node:path";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
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

type AuthRoute = "/login" | "/register";

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
 * Navigate to the requested authentication route and wait for the email and
 * password inputs to hydrate. Turbopack occasionally streams the surrounding
 * shell before the form renders, so we retry a handful of times instead of
 * timing out immediately and failing unrelated Playwright flows.
 */
/**
 * Maximum amount of time we are willing to wait for the authentication form
 * controls to hydrate. The initial Turbopack compilation on CI can easily take
 * more than a handful of seconds, so we give the runtime a generous window
 * before retrying.
 */
const AUTH_FORM_WAIT_TIMEOUT_MS = 45_000;

/**
 * Try to load and hydrate the requested authentication route. We reattempt the
 * navigation a few times to account for dev-server cold starts while keeping a
 * deterministic ceiling on how long Playwright blocks.
 */
async function loadAuthForm({
  baseURL,
  page,
  route,
  attempts = 5,
}: {
  baseURL: string;
  page: Page;
  route: AuthRoute;
  attempts?: number;
}): Promise<{ email: Locator; password: Locator }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(`${baseURL}${route}`, { waitUntil: "networkidle" });

      const email = page.getByPlaceholder("user@acme.com");
      const password = page.getByLabel("Password");

      await Promise.all([
        expect(email).toBeEditable({ timeout: AUTH_FORM_WAIT_TIMEOUT_MS }),
        expect(password).toBeEditable({ timeout: AUTH_FORM_WAIT_TIMEOUT_MS }),
      ]);

      return { email, password };
    } catch (error) {
      lastError = error;

      console.warn(
        `Failed to load ${route} form on attempt ${attempt}/${attempts}, retrying`,
        error
      );

      if (attempt < attempts) {
        await page.waitForTimeout(500 * attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to load authentication form");
}

export async function createAuthenticatedContext({
  browser,
  name,
}: {
  browser: Browser;
  name: string;
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
  const page = await context.newPage();

  /**
   * Provision the deterministic Playwright account via the dedicated testing
   * endpoint so we can jump straight to the login form regardless of how long
   * the registration UI takes to hydrate under cold starts.
   */
  const ensureUserResponse = await context.request.post(
    `${baseURL}/api/tests/auth/register`,
    {
      data: { email, password: resolvedPassword },
    }
  );

  if (!ensureUserResponse.ok()) {
    throw new Error(
      `Failed to provision Playwright test user: ${await ensureUserResponse.text()}`
    );
  }

  const { email: loginEmail, password: loginPassword } = await loadAuthForm({
    baseURL,
    page,
    route: "/login",
  });

  await loginEmail.fill(email);
  await loginPassword.fill(resolvedPassword);

  const signInButton = page.getByRole("button", { name: "Sign in" });

  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith("/login"), {
      timeout: AUTH_FORM_WAIT_TIMEOUT_MS,
      waitUntil: "commit",
    }),
    signInButton.click(),
  ]);

  const chatPage = new ChatPage(page);
  await chatPage.createNewChat();

  /**
   * Resolve the human-readable label for the reasoning model directly from the
   * shared chat model catalog. The product copy recently changed from the
   * generic "Reasoning model" wording to the branded "Grok Reasoning" label,
   * which caused the hard-coded assertion below to fall out of sync and break
   * every Playwright journey during authentication.
   */
  const reasoningModel = chatModels.find(
    (model) => model.id === "chat-model-reasoning"
  );

  if (!reasoningModel) {
    throw new Error("Unable to locate the reasoning chat model metadata");
  }

  await chatPage.chooseModelFromSelector(reasoningModel.id);
  await expect(chatPage.getSelectedModel()).resolves.toEqual(
    reasoningModel.name
  );

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
  const email = `test-${getUnixTime(new Date())}@playwright.com`;
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
