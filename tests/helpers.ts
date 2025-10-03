import fs from "node:fs";
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

  const context = await browser.newContext();
  const page = await context.newPage();

  const email = `test-${name}@playwright.com`;
  const password = generateId();

  const baseURL =
    process.env.PLAYWRIGHT_TEST_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3100}`;

  // Point the registration flow at the same origin Playwright uses for the
  // rest of the suite. The test web server now defaults to port 3100 so we
  // avoid hard-coding 3000 and breaking manual runs.
  await page.goto(`${baseURL}/register`);
  await page.getByPlaceholder("user@acme.com").click();
  await page.getByPlaceholder("user@acme.com").fill(email);
  await page.getByLabel("Password").click();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign Up" }).click();

  await expect(page.getByTestId("toast")).toContainText(
    "Account created successfully!"
  );

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
