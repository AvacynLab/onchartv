import { describe, expect, it, vi } from "vitest";

import {
  type ResponseLike,
  loginWithCredentialsCallback,
} from "@/tests/utils/programmatic-login";

const createResponse = (overrides: Partial<ResponseLike> = {}): ResponseLike => ({
  ok: overrides.ok ?? (() => true),
  status: overrides.status ?? (() => 200),
  json: overrides.json ?? (async () => ({ csrfToken: "token" })),
  text: overrides.text ?? (async () => ""),
  headers:
    overrides.headers ??
    (() => [
      {
        name: "set-cookie",
        value: "authjs.session-token=token; Path=/; HttpOnly",
      },
    ]),
});

describe("loginWithCredentialsCallback", () => {
  it("returns true when the credential callback issues a session cookie", async () => {
    const readCookies = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: "authjs.session-token" }]);

    const requestGet = vi.fn().mockResolvedValue(createResponse());
    const requestPost = vi.fn().mockResolvedValue(createResponse());

    const result = await loginWithCredentialsCallback({
      baseURL: "http://localhost:3100",
      email: "user@example.com",
      password: "password123",
      request: { get: requestGet, post: requestPost },
      readCookies,
      hasSessionCookie: (cookies) =>
        cookies.some(({ name }) => name.includes("session-token")),
      applyCookies: vi.fn(),
    });

    expect(result).toBe(true);
    expect(requestGet).toHaveBeenCalledTimes(1);
    expect(requestPost).toHaveBeenCalledTimes(1);
    expect(readCookies).toHaveBeenCalledTimes(3);
  });

  it("logs and returns false when the CSRF endpoint is unavailable", async () => {
    const logger = vi.fn();

    const result = await loginWithCredentialsCallback({
      baseURL: "http://localhost:3100",
      email: "user@example.com",
      password: "password123",
      request: {
        get: vi.fn().mockResolvedValue(
          createResponse({ ok: () => false, status: () => 503 })
        ),
        post: vi.fn(),
      },
      readCookies: vi.fn(),
      hasSessionCookie: vi.fn(),
      logger,
      applyCookies: vi.fn(),
    });

    expect(result).toBe(false);
    expect(logger).toHaveBeenCalledWith(
      "Credentials CSRF fetch failed",
      expect.objectContaining({ status: 503 })
    );
  });

  it("logs callback failures and avoids polling when the endpoint rejects", async () => {
    const logger = vi.fn();

    const result = await loginWithCredentialsCallback({
      baseURL: "https://example.com",
      email: "user@example.com",
      password: "password123",
      request: {
        get: vi.fn().mockResolvedValue(createResponse()),
        post: vi
          .fn()
          .mockResolvedValue(
            createResponse({
              ok: () => false,
              status: () => 401,
              text: async () => "Unauthorized",
            })
          ),
      },
      readCookies: vi.fn(),
      hasSessionCookie: () => false,
      logger,
      applyCookies: vi.fn(),
    });

    expect(result).toBe(false);
    expect(logger).toHaveBeenCalledWith(
      "Credentials callback returned error status",
      expect.objectContaining({ status: 401 })
    );
  });

  it("treats redirect responses with cookies as a successful login", async () => {
    const readCookies = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: "authjs.session-token" }]);

    const postSpy = vi
      .fn()
      .mockResolvedValue(
        createResponse({
          ok: () => false,
          status: () => 302,
        })
      );

    const result = await loginWithCredentialsCallback({
      baseURL: "https://example.com",
      email: "user@example.com",
      password: "password123",
      request: {
        get: vi.fn().mockResolvedValue(createResponse()),
        post: postSpy,
      },
      readCookies,
      hasSessionCookie: (cookies) =>
        cookies.some((cookie) => cookie.name.includes("session-token")),
      applyCookies: vi.fn(),
    });

    expect(result).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(readCookies).toHaveBeenCalledTimes(2);
  });

  it("requests a JSON response to avoid redirect-only callbacks", async () => {
    const postSpy = vi
      .fn()
      .mockResolvedValue(createResponse());

    await loginWithCredentialsCallback({
      baseURL: "https://example.com",
      email: "user@example.com",
      password: "password123",
      request: {
        get: vi.fn().mockResolvedValue(createResponse()),
        post: postSpy,
      },
      readCookies: vi.fn().mockResolvedValue([{ name: "authjs.session-token" }]),
      hasSessionCookie: () => true,
      applyCookies: vi.fn(),
    });

    const [, options] = postSpy.mock.calls[0];
    expect(options?.form).toMatchObject({ redirect: "false", json: "true" });
    expect(options?.maxRedirects).toBe(0);
  });

  it("polls for the session cookie and logs when none is issued", async () => {
    const logger = vi.fn();
    const readCookies = vi.fn().mockResolvedValue([]);

    const result = await loginWithCredentialsCallback({
      baseURL: "https://example.com",
      email: "user@example.com",
      password: "password123",
      request: {
        get: vi.fn().mockResolvedValue(createResponse()),
        post: vi.fn().mockResolvedValue(createResponse()),
      },
      readCookies,
      hasSessionCookie: () => false,
      logger,
      cookiePollAttempts: 2,
      applyCookies: vi.fn(),
    });

    expect(result).toBe(false);
    expect(logger).toHaveBeenLastCalledWith(
      "Credentials callback completed but session cookie missing",
      expect.objectContaining({ attempts: 2 })
    );
    expect(readCookies).toHaveBeenCalledTimes(2);
  });

  it("applies cookies parsed from the callback response before polling", async () => {
    const applyCookies = vi.fn();
    const readCookies = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: "__Secure-next-auth.session-token" }]);

    const responseHeaders = [
      {
        name: "set-cookie",
        value:
          "__Secure-next-auth.session-token=secure-token; Path=/; HttpOnly; Secure; SameSite=Lax",
      },
      {
        name: "set-cookie",
        value: "next-auth.csrf-token=csrf; Path=/; HttpOnly",
      },
    ];

    const result = await loginWithCredentialsCallback({
      baseURL: "http://localhost:3100", // origin used to populate cookie URL
      email: "user@example.com",
      password: "password123",
      request: {
        get: vi.fn().mockResolvedValue(createResponse()),
        post: vi.fn().mockResolvedValue(createResponse({ headers: () => responseHeaders })),
      },
      readCookies,
      hasSessionCookie: (cookies) =>
        cookies.some((cookie) => cookie.name.includes("session-token")),
      applyCookies,
    });

    expect(result).toBe(true);
    expect(applyCookies).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: "__Secure-next-auth.session-token",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          url: "http://localhost:3100",
        }),
      ])
    );
    expect(readCookies).toHaveBeenCalledTimes(2);
  });

  it("logs a warning when set-cookie parsing fails", async () => {
    const logger = vi.fn();

    const result = await loginWithCredentialsCallback({
      baseURL: "https://example.com",
      email: "user@example.com",
      password: "password123",
      request: {
        get: vi.fn().mockResolvedValue(createResponse()),
        post: vi
          .fn()
          .mockResolvedValue(
            createResponse({
              headers: () => [
                {
                  name: "set-cookie",
                  value: "invalid-cookie",
                },
              ],
            })
          ),
      },
      readCookies: vi.fn().mockResolvedValue([]),
      hasSessionCookie: () => false,
      logger,
      cookiePollAttempts: 1,
      applyCookies: vi.fn(),
    });

    expect(result).toBe(false);
    expect(logger).toHaveBeenCalledWith(
      "Failed to parse set-cookie header",
      expect.objectContaining({ header: "invalid-cookie" })
    );
  });
});
