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
 * Navigate to the requested authentication route and wait for the email and
 * password inputs to hydrate. Turbopack occasionally streams the surrounding
 * shell before the form renders, so we retry a handful of times instead of
 * timing out immediately and failing unrelated Playwright flows.
 */
async function loadAuthForm({
  baseURL,
  page,
  route,
  attempts = 3,
}: {
  baseURL: string;
  page: Page;
  route: AuthRoute;
  attempts?: number;
}): Promise<{ email: Locator; password: Locator }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });

      const email = page.getByPlaceholder("user@acme.com");
      const password = page.getByLabel("Password");

      await Promise.all([
        email.waitFor({ state: "visible", timeout: 20_000 }),
        password.waitFor({ state: "visible", timeout: 20_000 }),
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

  const context = await browser.newContext();
  const page = await context.newPage();

  const email = `test-${name}@playwright.com`;
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

  const baseURL =
    process.env.PLAYWRIGHT_TEST_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3100}`;

  const { email: registerEmail, password: registerPassword } =
    await loadAuthForm({
      baseURL,
      page,
      route: "/register",
    });

  await registerEmail.fill(email);
  await registerPassword.fill(resolvedPassword);

  const signUpButton = page.getByRole("button", { name: "Sign Up" });
  await signUpButton.click();

  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("Account", { timeout: 30_000 });

  const toastMessage = (await toast.textContent()) ?? "";

  if (toastMessage.includes("Account already exists!")) {
    /**
     * Rejoindre le formulaire de connexion avec les identifiants persistés
     * permet de récupérer la session lorsque la configuration Playwright
     * réutilise le même utilisateur logique sur plusieurs tentatives.
     */
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
        timeout: 20_000,
        waitUntil: "commit",
      }),
      signInButton.click(),
    ]);
  } else if (!toastMessage.includes("Account created successfully!")) {
    throw new Error(
      `Unexpected register toast content: "${toastMessage.trim()}"`
    );
  }

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
