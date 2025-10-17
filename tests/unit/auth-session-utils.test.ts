import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTH_SESSION_COOKIE_IDENTIFIERS,
  hasAuthSessionCookie,
  isAuthSessionCookieName,
} from "../utils/auth-session";

describe("hasAuthSessionCookie", () => {
  it("returns true when the auth session cookie is present", () => {
    const result = hasAuthSessionCookie([
      { name: "other-cookie" },
      { name: "authjs.session-token" },
    ]);

    assert.equal(result, true);
  });

  it("matches legacy NextAuth cookie names", () => {
    const result = hasAuthSessionCookie([
      { name: "next-auth.session-token" },
    ]);

    assert.equal(result, true);
  });

  it("matches secure-prefixed session cookies", () => {
    const result = hasAuthSessionCookie([
      { name: "__Secure-next-auth.session-token" },
    ]);

    assert.equal(result, true);
  });

  it("returns false when the auth session cookie is absent", () => {
    const result = hasAuthSessionCookie([
      { name: "next-auth.pkce.code_verifier" },
      { name: "playwright-id" },
    ]);

    assert.equal(result, false);
  });

  it("handles an empty cookie list", () => {
    const result = hasAuthSessionCookie([]);

    assert.equal(result, false);
  });
});

describe("isAuthSessionCookieName", () => {
  it("covers all known identifier substrings", () => {
    for (const identifier of AUTH_SESSION_COOKIE_IDENTIFIERS) {
      assert.equal(
        isAuthSessionCookieName(`${identifier}::suffix`),
        true,
      );
    }
  });

  it("returns false for unrelated cookies", () => {
    assert.equal(isAuthSessionCookieName("session"), false);
  });
});
