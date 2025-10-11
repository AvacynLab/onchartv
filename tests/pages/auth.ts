import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { signInPlaywrightUser } from "../helpers";
import {
  clearPersistedSessionCookies,
  hasPersistedSessionCookies,
  persistSessionCookies,
  restoreSessionCookies,
} from "../utils/session-persistence";
import { hasAuthSessionCookie } from "../utils/auth-session";

const TOAST_LOCATOR = '[data-testid="toast"], #automation-toast-bridge';

export class AuthPage {
  private readonly page: Page;
  private readonly baseURL: string;

  constructor(page: Page) {
    this.page = page;
    this.baseURL =
      process.env.PLAYWRIGHT_TEST_BASE_URL ??
      `http://localhost:${process.env.PORT ?? 3100}`;
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

  async login(
    email: string,
    password: string,
    options: { reusePersistedSession?: boolean } = {},
  ) {
    const { reusePersistedSession = true } = options;

    if (reusePersistedSession && (await this.restorePersistedSession(email))) {
      await this.page.goto("/");
      await this.persistSessionCookies();
      return;
    }

    await this.gotoLogin();
    await this.page.getByPlaceholder("user@acme.com").click();
    await this.page.getByPlaceholder("user@acme.com").fill(email);
    await this.page.getByLabel("Password").click();
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: "Sign In" }).click();
    await this.persistSessionCookies();
  }

  async ensureAuthenticatedSession(email: string, password: string) {
    if (await this.restorePersistedSession(email)) {
      await this.page.goto("/");
      await this.persistSessionCookies();
      return;
    }

    await this.page.context().clearCookies();

    const response = await this.page.context().request.post(
      `${this.baseURL}/api/tests/auth/register`,
      {
        data: { email, password },
      },
    );

    if (!response.ok()) {
      throw new Error(
        `Failed to provision Playwright session: ${response.status()} ${await response.text()}`,
      );
    }

    await signInPlaywrightUser({
      baseURL: this.baseURL,
      context: this.page.context(),
      email,
      password,
    });

    await this.persistSessionCookies();
    await this.page.goto("/");
  }

  async logout(email: string, password: string) {
    await this.ensureAuthenticatedSession(email, password);
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

    await userNavButton.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    });
    await userNavButton.scrollIntoViewIfNeeded();
    await userNavButton.click();
    const userNavMenu = this.page.getByTestId("user-nav-menu");
    await expect(userNavMenu).toBeVisible();

    const authMenuItem = this.page.getByTestId("user-nav-item-auth");
    await expect(authMenuItem).toContainText("Sign out");

    await authMenuItem.click();

    await this.page.waitForURL(/\/login/);
    await expect(this.page.getByRole("heading", { level: 3, name: "Sign In" })).toBeVisible();
    clearPersistedSessionCookies();
  }

  async expectToastToContain(text: string) {
    const toast = this.page.locator(TOAST_LOCATOR).first();

    /**
     * Playwright occasionally navigates away from the auth surface before the
     * Sonner portal flips the toast into the visible state. Observe both the
     * `visible` and `attached` transitions so automation can still verify the
     * success copy even when the notification hides during the redirect.
     */
    const becameVisible = await toast
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => true)
      .catch(async (error) => {
        const attached = await toast
          .waitFor({ state: "attached", timeout: 1_000 })
          .then(() => true)
          .catch(() => false);

        if (!attached) {
          throw new Error(
            `Timed out waiting for toast containing: "${text}"`,
            error instanceof Error ? { cause: error } : undefined
          );
        }

        return false;
      });

    if (!becameVisible) {
      await this.page.waitForTimeout(100).catch(() => {});
    }

    await expect(toast).toContainText(text);
  }

  async openSidebar() {
    const sidebarState = await this.page
      .evaluate(() => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]');
        const container = sidebar?.closest('[data-state]');
        return container?.getAttribute("data-state") ?? null;
      })
      .catch(() => null);

    if (sidebarState === "expanded") {
      return;
    }

    const sidebarToggleButton = this.page.getByTestId("sidebar-toggle-button");

    // Garantit que le bouton est dans le viewport avant d'interagir : en
    // mode sidebar compact, le toggle peut être partiellement masqué lorsque
    // Playwright restaure une session existante.
    await sidebarToggleButton.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "center" });
    });
    await sidebarToggleButton.scrollIntoViewIfNeeded();
    await sidebarToggleButton.click();
    await this.page.waitForFunction(
      () => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]');
        const container = sidebar?.closest('[data-state]');
        return container?.getAttribute("data-state") === "expanded";
      },
      undefined,
      { timeout: 30_000 }
    );
  }

  async persistSessionCookies() {
    await persistSessionCookies(this.page.context());
  }

  private async restorePersistedSession(email: string): Promise<boolean> {
    if (!hasPersistedSessionCookies()) {
      return false;
    }

    const context = this.page.context();
    await context.clearCookies();

    const restored = await restoreSessionCookies(context, this.baseURL);

    if (!restored) {
      return false;
    }

    const cookies = await context.cookies();

    if (!hasAuthSessionCookie(cookies)) {
      return false;
    }

    const sessionResponse = await context.request.get(
      `${this.baseURL}/api/auth/session`,
    );

    if (!sessionResponse.ok()) {
      return false;
    }

    const session = (await sessionResponse.json()) as
      | { user?: { email?: string | null } | null }
      | null;

    if (session?.user?.email?.toLowerCase() !== email.toLowerCase()) {
      return false;
    }

    return true;
  }
}

