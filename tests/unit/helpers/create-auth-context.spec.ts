import type { Browser, BrowserContext } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  signInPlaywrightUser,
  tryRestoreSessionFromStorage,
} from "../../helpers";

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  __esModule: true,
  default: fsMocks,
  ...fsMocks,
}));

const existsSyncMock = fsMocks.existsSync;

describe("tryRestoreSessionFromStorage", () => {
  afterEach(() => {
    existsSyncMock.mockReset();
    vi.clearAllMocks();
  });

  it("reuses a stored session when the server confirms the user", async () => {
    existsSyncMock.mockReturnValue(true);

    const newPage = vi.fn().mockResolvedValue({ close: vi.fn() });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => true,
      json: async () => ({ user: { email: "test-user@example.com" } }),
    });
    const close = vi.fn().mockResolvedValue(undefined);

    const browser = {
      newContext: vi.fn().mockResolvedValue({
        request: { get: requestGet },
        newPage,
        close,
      }),
    } as unknown as Browser;

    const restored = await tryRestoreSessionFromStorage({
      baseURL: "http://127.0.0.1:3100",
      browser,
      expectedEmail: "test-user@example.com",
      storageStatePath: "/tmp/state.json",
    });

    expect(restored).not.toBeNull();
    expect(requestGet).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/auth/session"
    );
    expect(newPage).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("falls back to UI auth when the stored session belongs to another user", async () => {
    existsSyncMock.mockReturnValue(true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const close = vi.fn().mockResolvedValue(undefined);

    const browser = {
      newContext: vi.fn().mockResolvedValue({
        request: {
          get: vi.fn().mockResolvedValue({
            ok: () => true,
            json: async () => ({ user: { email: "other@example.com" } }),
          }),
        },
        newPage: vi.fn(),
        close,
      }),
    } as unknown as Browser;

    const restored = await tryRestoreSessionFromStorage({
      baseURL: "http://127.0.0.1:3100",
      browser,
      expectedEmail: "test-user@example.com",
      storageStatePath: "/tmp/state.json",
    });

    expect(restored).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("skips reuse entirely when there is no stored state", async () => {
    existsSyncMock.mockReturnValue(false);

    const browser = {
      newContext: vi.fn(),
    } as unknown as Browser;

    const restored = await tryRestoreSessionFromStorage({
      baseURL: "http://127.0.0.1:3100",
      browser,
      expectedEmail: "test-user@example.com",
      storageStatePath: "/tmp/state.json",
    });

    expect(restored).toBeNull();
    expect(browser.newContext).not.toHaveBeenCalled();
  });
});

describe("signInPlaywrightUser", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const baseURL = "http://127.0.0.1:3100";
  const email = "playwright@example.com";
  const password = "secret";

  it("performs a credentials sign-in and waits for the session", async () => {
    const post = vi.fn().mockResolvedValue({
      status: () => 200,
      text: async () => "",
    });

    const get = vi
      .fn()
      .mockResolvedValueOnce({
        ok: () => true,
        json: async () => ({ csrfToken: "token" }),
      })
      .mockResolvedValueOnce({
        ok: () => true,
        json: async () => ({ user: { email } }),
      });

    const context = {
      request: { get, post },
    } as unknown as BrowserContext;

    await signInPlaywrightUser({
      baseURL,
      context,
      email,
      password,
      sessionPollIntervalMs: 1,
      sessionPollTimeoutMs: 25,
    });

    expect(post).toHaveBeenCalledWith(
      `${baseURL}/api/auth/callback/credentials`,
      expect.objectContaining({
        form: expect.objectContaining({ email, password }),
      })
    );

    expect(get).toHaveBeenLastCalledWith(`${baseURL}/api/auth/session`);
  });

  it("throws when the CSRF endpoint fails", async () => {
    const context = {
      request: {
        get: vi.fn().mockResolvedValue({
          ok: () => false,
          status: () => 500,
          text: async () => "no csrf",
        }),
        post: vi.fn(),
      },
    } as unknown as BrowserContext;

    await expect(
      signInPlaywrightUser({
        baseURL,
        context,
        email,
        password,
        sessionPollIntervalMs: 1,
        sessionPollTimeoutMs: 5,
      })
    ).rejects.toThrow(/Failed to retrieve CSRF token/);
  });

  it("times out when the session never matches the target email", async () => {
    const post = vi.fn().mockResolvedValue({
      status: () => 200,
      text: async () => "",
    });

    const get = vi
      .fn()
      .mockResolvedValueOnce({
        ok: () => true,
        json: async () => ({ csrfToken: "token" }),
      })
      .mockResolvedValue({
        ok: () => true,
        json: async () => ({ user: { email: "someone-else@example.com" } }),
      });

    const context = {
      request: { get, post },
    } as unknown as BrowserContext;

    await expect(
      signInPlaywrightUser({
        baseURL,
        context,
        email,
        password,
        sessionPollIntervalMs: 1,
        sessionPollTimeoutMs: 5,
      })
    ).rejects.toThrow(/Timed out waiting/);
  });
});
