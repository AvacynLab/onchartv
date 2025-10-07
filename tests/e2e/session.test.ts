import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { generateRandomTestUser } from "../helpers";
import { AuthPage } from "../pages/auth";
import { persistSessionCookies } from "../utils/session-persistence";

const waitForChatDashboard = async (page: Page) => {
  const composer = page.getByPlaceholder("Send a message...");

  // Once the textarea is rendered ensure the Playwright assertion API also
  // sees it as visible so downstream tests can safely interact with it.
  await expect(composer).toBeVisible({ timeout: 60_000 });

  /**
   * Successful logins redirect users to either `/` or the latest `/chat/:id`.
   * Allow for transient query parameters that Next.js may append during the
   * client-side transition while still failing the test if the flow remains on
   * the `/login` route.
   */
  await expect(page).toHaveURL(/\/(?:chat\/[^/?#]+)?(?:\?.*)?$/);
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
  let testUser = generateRandomTestUser();

  test.beforeEach(({ page }) => {
    authPage = new AuthPage(page);
  });

test("Register new account", async ({ page }) => {
  await authPage.register(testUser.email, testUser.password);
  await authPage.expectToastToContain("Account created successfully!");
  // Persist the freshly issued session cookies so later tests can reuse the
  // authenticated context without resubmitting the login form, which reduces
  // flakiness and keeps the flow deterministic across retries.
  await persistSessionCookies(page.context());
});

  test("Reject login attempts with invalid credentials", async () => {
    // Use an obviously incorrect password to confirm the UI surfaces the
    // authentication error toast returned by the server action.
    await authPage.login(testUser.email, "incorrect-password", {
      reusePersistedSession: false,
    });
    await authPage.expectToastToContain("Invalid credentials!");
  });

  test("Register new account with existing email", async () => {
    await authPage.register(testUser.email, testUser.password);
    await authPage.expectToastToContain("Account already exists!");
  });

  test("Log into account that exists", async ({ page }) => {
    await authPage.ensureAuthenticatedSession(testUser.email, testUser.password);

    await waitForChatDashboard(page);
    await expect(page.getByPlaceholder("Send a message...")).toBeVisible();
  });

  test("Display user email in user menu", async ({ page }) => {
    await authPage.ensureAuthenticatedSession(testUser.email, testUser.password);

    await waitForChatDashboard(page);
    await expect(page.getByPlaceholder("Send a message...")).toBeVisible();

    const userEmail = await page.getByTestId("user-email");
    await expect(userEmail).toHaveText(testUser.email);
  });

  test("Log out as non-guest user", async () => {
    await authPage.logout(testUser.email, testUser.password);
    testUser = generateRandomTestUser();
  });

  test("Do not navigate to /register for authenticated users", async ({
    page,
  }) => {
    await authPage.ensureAuthenticatedSession(testUser.email, testUser.password);
    await waitForChatDashboard(page);

    await page.goto("/register");
    await expect(page).toHaveURL(/\/(chat\/[^/]+)?$/);
  });

  test("Do not navigate to /login for authenticated users", async ({ page }) => {
    await authPage.ensureAuthenticatedSession(testUser.email, testUser.password);
    await waitForChatDashboard(page);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/(chat\/[^/]+)?$/);
  });
});



