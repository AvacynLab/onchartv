import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasAuthSessionCookie } from "../utils/auth-session";

describe("hasAuthSessionCookie", () => {
  it("returns true when the auth session cookie is present", () => {
    const result = hasAuthSessionCookie([
      { name: "other-cookie" },
      { name: "authjs.session-token" },
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
