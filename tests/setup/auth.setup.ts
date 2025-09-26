import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { expect, test as setup } from "@playwright/test";

const AUTH_DIR = path.resolve(__dirname, "../.auth");
const STATE_PATH = path.join(AUTH_DIR, "state.json");
const CREDENTIALS_PATH = path.join(AUTH_DIR, "user.json");

function loadCredentials() {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { email: string; password: string };
    if (parsed.email && parsed.password) {
      return parsed;
    }
  }

  const email = process.env.E2E_USER_EMAIL ?? `e2e-${Date.now()}@playwright.com`;
  const password =
    process.env.E2E_USER_PASSWORD ?? `E2e-${randomBytes(6).toString("hex")}!`;

  const creds = { email, password };
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
  return creds;
}

async function ensureLoggedIn(
  page: import("@playwright/test").Page,
  creds: { email: string; password: string }
) {
  await page.goto("/login");

  if (page.url().endsWith("/login")) {
    await page.getByPlaceholder("user@acme.com").fill(creds.email);
    await page.getByLabel("Password").fill(creds.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect
      .poll(async () => {
        const cookies = await page.context().cookies();
        return cookies.some(({ name }) => name.includes("authjs.session-token"));
      }, { timeout: 15_000 })
      .toBeTruthy();
  }
}

setup("authenticate", async ({ page }) => {
  const credentials = loadCredentials();

  await page.goto("/register");
  await page.getByPlaceholder("user@acme.com").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign Up" }).click();

  await ensureLoggedIn(page, credentials);

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: STATE_PATH });
});

