import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { generateRandomTestUser } from "../helpers";
import { AuthPage } from "../pages/auth";

const waitForChatDashboard = async (page: Page) => {
  /**
   * Successful logins trigger a client-side redirect to either `/` or the
   * latest `/chat/:id`. Waiting on the browser location first gives the router
   * enough time to settle before we assert on the hydrated composer textarea.
   */
  await page.waitForFunction(
    () =>
      window.location.pathname === "/" ||
      window.location.pathname.startsWith("/chat/"),
    null,
    { timeout: 60_000 }
  );

  const composer = page.getByPlaceholder("Send a message...");

  // Once the textarea is rendered ensure the Playwright assertion API also
  // sees it as visible so downstream tests can safely interact with it.
  await expect(composer).toBeVisible({ timeout: 60_000 });
};

test.describe("Access Control", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });
  test.use({ storageState: undefined });
  test("Redirect unauthenticated user to login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login\?callbackUrl=/);
    expect(page.url()).toContain("/login?callbackUrl=");
  });

  test("Allow navigating to login when unauthenticated", async ({ page }) => {
    await page.goto("/login");
    await page.waitForURL("/login");
    await expect(page).toHaveURL("/login");
  });

  test("Allow navigating to register when unauthenticated", async ({ page }) => {
    await page.goto("/register");
    await page.waitForURL("/register");
    await expect(page).toHaveURL("/register");
  });
});

test.describe.serial("Login and Registration", () => {
  test.use({ storageState: undefined });
  let authPage: AuthPage;
  const testUser = generateRandomTestUser();

  test.beforeEach(({ page }) => {
    authPage = new AuthPage(page);
  });

  test("Register new account", async () => {
    await authPage.register(testUser.email, testUser.password);
    await authPage.expectToastToContain("Account created successfully!");
  });

  test("Reject login attempts with invalid credentials", async () => {
    // Use an obviously incorrect password to confirm the UI surfaces the
    // authentication error toast returned by the server action.
    await authPage.login(testUser.email, "incorrect-password");
    await authPage.expectToastToContain("Invalid credentials!");
  });

  test("Register new account with existing email", async () => {
    await authPage.register(testUser.email, testUser.password);
    await authPage.expectToastToContain("Account already exists!");
  });

  test("Log into account that exists", async ({ page }) => {
    await authPage.login(testUser.email, testUser.password);

    await waitForChatDashboard(page);
    await expect(page.getByPlaceholder("Send a message...")).toBeVisible();
  });

  test("Display user email in user menu", async ({ page }) => {
    await authPage.login(testUser.email, testUser.password);

    await waitForChatDashboard(page);
    await expect(page.getByPlaceholder("Send a message...")).toBeVisible();

    const userEmail = await page.getByTestId("user-email");
    await expect(userEmail).toHaveText(testUser.email);
  });

  test("Log out as non-guest user", async () => {
    await authPage.logout(testUser.email, testUser.password);
  });

  test("Do not navigate to /register for authenticated users", async ({
    page,
  }) => {
    await authPage.login(testUser.email, testUser.password);
    await waitForChatDashboard(page);

    await page.goto("/register");
    await expect(page).toHaveURL(/\/(chat\/[^/]+)?$/);
  });

  test("Do not navigate to /login for authenticated users", async ({ page }) => {
    await authPage.login(testUser.email, testUser.password);
    await waitForChatDashboard(page);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/(chat\/[^/]+)?$/);
  });
});



