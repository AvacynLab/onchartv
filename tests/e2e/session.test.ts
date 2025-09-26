import { expect, test } from "../fixtures";
import { generateRandomTestUser } from "../helpers";
import { AuthPage } from "../pages/auth";

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

  test("Register new account with existing email", async () => {
    await authPage.register(testUser.email, testUser.password);
    await authPage.expectToastToContain("Account already exists!");
  });

  test("Log into account that exists", async ({ page }) => {
    await authPage.login(testUser.email, testUser.password);

    await page.waitForURL("/");
    await expect(page.getByPlaceholder("Send a message...")).toBeVisible();
  });

  test("Display user email in user menu", async ({ page }) => {
    await authPage.login(testUser.email, testUser.password);

    await page.waitForURL("/");
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
    await page.waitForURL("/");

    await page.goto("/register");
    await expect(page).toHaveURL("/");
  });

  test("Do not navigate to /login for authenticated users", async ({ page }) => {
    await authPage.login(testUser.email, testUser.password);
    await page.waitForURL("/");

    await page.goto("/login");
    await expect(page).toHaveURL("/");
  });
});



