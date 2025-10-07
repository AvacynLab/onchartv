import type { Page } from "@playwright/test";
import { expect } from "../fixtures";

export class AuthPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Reset the credentials for a deterministic Playwright account by invoking
   * the test-only password reset endpoint. The helper keeps the E2E suite in
   * sync with the registration flow even after negative login scenarios mutate
   * the in-memory store, ensuring subsequent tests interact with a known good
   * password hash before attempting to sign in through the UI.
   */
  async resetPassword(email: string, password: string) {
    const response = await this.page.request.post(
      "/api/tests/auth/reset-password",
      {
        data: { email, password },
      }
    );

    expect(response.status(), "password reset request should succeed").toBe(200);
    const payload = (await response.json()) as { status?: string };
    expect(payload.status).toBe("updated");
  }

  async gotoLogin() {
    await this.page.context().clearCookies();
    await this.page.goto("/login");
    await expect(this.page.getByRole("heading", { level: 3, name: "Sign In" })).toBeVisible();
  }

  async gotoRegister() {
    await this.page.context().clearCookies();
    await this.page.goto("/register");
    await expect(this.page.getByRole("heading", { level: 3, name: "Sign Up" })).toBeVisible();
  }

  async register(email: string, password: string) {
    await this.gotoRegister();
    await this.page.getByPlaceholder("user@acme.com").click();
    await this.page.getByPlaceholder("user@acme.com").fill(email);
    await this.page.getByLabel("Password").click();
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: "Sign Up" }).click();
  }

  async login(email: string, password: string) {
    await this.gotoLogin();
    await this.page.getByPlaceholder("user@acme.com").click();
    await this.page.getByPlaceholder("user@acme.com").fill(email);
    await this.page.getByLabel("Password").click();
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: "Sign In" }).click();
  }

  async logout(email: string, password: string) {
    await this.login(email, password);
    // The dashboard navigation is a client-side transition that rewrites the
    // location to `/chat/:id`. Poll the browser location rather than waiting
    // for a specific static URL so the helper stays resilient to the history
    // updates performed by the chat shell.
    await this.page.waitForFunction(
      () =>
        window.location.pathname === "/" ||
        window.location.pathname.startsWith("/chat/"),
      null,
      { timeout: 60_000 }
    );

    await this.openSidebar();

    const userNavButton = this.page.getByTestId("user-nav-button");
    await expect(userNavButton).toBeVisible();

    await userNavButton.click();
    const userNavMenu = this.page.getByTestId("user-nav-menu");
    await expect(userNavMenu).toBeVisible();

    const authMenuItem = this.page.getByTestId("user-nav-item-auth");
    await expect(authMenuItem).toContainText("Sign out");

    await authMenuItem.click();

    await this.page.waitForURL(/\/login/);
    await expect(this.page.getByRole("heading", { level: 3, name: "Sign In" })).toBeVisible();
  }

  async expectToastToContain(text: string) {
    await expect(this.page.getByTestId("toast")).toContainText(text);
  }

  async openSidebar() {
    const sidebarToggleButton = this.page.getByTestId("sidebar-toggle-button");
    await sidebarToggleButton.click();
  }
}

