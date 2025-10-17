import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Cookie } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  __getSessionCookiePathForTests,
  clearPersistedSessionCookies,
  hasPersistedSessionCookies,
  persistSessionCookies,
  restoreSessionCookies,
} from "../../utils/session-persistence";

type MockContext = Pick<BrowserContext, "cookies" | "addCookies">;

const SESSION_PATH = __getSessionCookiePathForTests();

describe("session persistence utilities", () => {
  beforeEach(() => {
    if (fs.existsSync(SESSION_PATH)) {
      fs.rmSync(SESSION_PATH);
    }
    const dir = path.dirname(SESSION_PATH);
    fs.mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(SESSION_PATH)) {
      fs.rmSync(SESSION_PATH);
    }
  });

  test.each([
    ["authjs.session-token"],
    ["__Secure-next-auth.session-token"],
  ])("persists and restores the %s cookie", async (cookieName) => {
    const cookie: Cookie = {
      domain: "localhost",
      expires: Date.now() / 1000 + 3600,
      httpOnly: true,
      name: cookieName,
      path: "/",
      sameSite: "Lax",
      secure: cookieName.startsWith("__Secure-"),
      value: "token-value",
    };

    const cookiesMock = vi.fn().mockResolvedValue([cookie]);
    const addCookiesMock = vi.fn().mockResolvedValue(undefined);

    const context: MockContext = {
      cookies: cookiesMock,
      addCookies: addCookiesMock,
    } as MockContext;

    expect(hasPersistedSessionCookies()).toBe(false);

    await persistSessionCookies(context as unknown as BrowserContext);

    expect(hasPersistedSessionCookies()).toBe(true);
    expect(fs.readFileSync(SESSION_PATH, "utf-8")).toContain(cookieName);

    const restored = await restoreSessionCookies(
      context as unknown as BrowserContext,
      "http://localhost:3000",
    );

    expect(restored).toBe(true);
    expect(addCookiesMock).toHaveBeenCalledWith([cookie]);
  });

  test("ignores persistence when no auth cookies are present", async () => {
    const context: MockContext = {
      cookies: vi.fn().mockResolvedValue([]),
      addCookies: vi.fn(),
    } as MockContext;

    await persistSessionCookies(context as unknown as BrowserContext);

    expect(hasPersistedSessionCookies()).toBe(false);
  });

  test("clears persisted cookies", async () => {
    fs.writeFileSync(SESSION_PATH, "{}");

    expect(hasPersistedSessionCookies()).toBe(true);

    clearPersistedSessionCookies();

    expect(hasPersistedSessionCookies()).toBe(false);
  });
  });

