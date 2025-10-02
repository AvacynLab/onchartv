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
