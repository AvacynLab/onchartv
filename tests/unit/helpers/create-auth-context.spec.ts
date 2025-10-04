import type { Browser } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { tryRestoreSessionFromStorage } from "../../helpers";

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
