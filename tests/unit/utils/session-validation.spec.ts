import { describe, expect, it, vi } from "vitest";

import { hasValidAuthSession } from "@/tests/utils/session-validation";

const BASE_URL = "http://localhost:3100";

/** Utility helper to build a stub response returned by the session fetcher. */
function createSessionResponse(
  overrides: Partial<{
    ok: () => boolean;
    status: () => number;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  }> = {},
) {
  return {
    ok: () => true,
    status: () => 200,
    json: async () => ({ user: { id: "user-id" } }),
    text: async () => "",
    ...overrides,
  } satisfies Parameters<typeof hasValidAuthSession>[0]["fetchSession"] extends (
    url: string,
  ) => infer Response
    ? Response
    : never;
}

describe("hasValidAuthSession", () => {
  it("returns false when the context does not hold an auth cookie", async () => {
    const readCookies = vi.fn().mockResolvedValue([{ name: "other" }]);
    const fetchSession = vi.fn();

    const result = await hasValidAuthSession({
      readCookies,
      fetchSession,
      baseURL: BASE_URL,
    });

    expect(result).toBe(false);
    expect(fetchSession).not.toHaveBeenCalled();
  });

  it("returns false when the session endpoint rejects the request", async () => {
    const readCookies = vi
      .fn()
      .mockResolvedValue([{ name: "authjs.session-token" }]);
    const fetchSession = vi
      .fn()
      .mockResolvedValue(
        createSessionResponse({
          ok: () => false,
          status: () => 401,
          text: async () => "Unauthorized",
        }),
      );
    const logger = vi.fn();

    const result = await hasValidAuthSession({
      readCookies,
      fetchSession,
      baseURL: BASE_URL,
      logger,
    });

    expect(result).toBe(false);
    expect(fetchSession).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      "Playwright session validation failed",
      expect.objectContaining({
        baseURL: BASE_URL,
        status: 401,
      })
    );
  });

  it("returns false when the session payload cannot be parsed", async () => {
    const readCookies = vi
      .fn()
      .mockResolvedValue([{ name: "next-auth.session-token" }]);
    const fetchSession = vi
      .fn()
      .mockResolvedValue(
        createSessionResponse({
          json: async () => {
            throw new Error("invalid json");
          },
        }),
      );

    await expect(
      hasValidAuthSession({
        readCookies,
        fetchSession,
        baseURL: BASE_URL,
      }),
    ).resolves.toBe(false);
  });

  it("returns false when the payload misses the user identifier", async () => {
    const readCookies = vi
      .fn()
      .mockResolvedValue([{ name: "authjs.session-token" }]);
    const fetchSession = vi
      .fn()
      .mockResolvedValue(
        createSessionResponse({
          json: async () => ({ user: {} }),
        }),
      );

    const result = await hasValidAuthSession({
      readCookies,
      fetchSession,
      baseURL: BASE_URL,
    });

    expect(result).toBe(false);
  });

  it("returns true when the session endpoint responds with a valid payload", async () => {
    const readCookies = vi
      .fn()
      .mockResolvedValue([{ name: "next-auth.session-token" }]);
    const fetchSession = vi
      .fn()
      .mockResolvedValue(createSessionResponse());

    const result = await hasValidAuthSession({
      readCookies,
      fetchSession,
      baseURL: BASE_URL,
    });

    expect(result).toBe(true);
  });

  it("returns false and logs when the base URL cannot be parsed", async () => {
    const readCookies = vi
      .fn()
      .mockResolvedValue([{ name: "next-auth.session-token" }]);
    const fetchSession = vi.fn();
    const logger = vi.fn();

    const result = await hasValidAuthSession({
      readCookies,
      fetchSession,
      baseURL: "invalid-base-url",
      logger,
    });

    expect(result).toBe(false);
    expect(fetchSession).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      "Failed to construct session validation endpoint",
      expect.objectContaining({ baseURL: "invalid-base-url" })
    );
  });
});
