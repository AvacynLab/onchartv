/**
 * Unit coverage for the helpers that interpret NextAuth sign-in responses.
 * These assertions guard against regressions when the credentials provider
 * changes its return values across environments and ensure our server actions
 * keep surfacing the correct UI states during Playwright runs.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  didSignInSucceed,
  extractRedirectPath,
} from "../../lib/auth/sign-in-response";

test.describe("didSignInSucceed", () => {
  test("treats undefined results as a success", () => {
    assert.equal(
      didSignInSucceed(undefined),
      true,
      "NextAuth returning undefined should mark the login as successful",
    );
  });

  test("returns false when the response reports a failure", () => {
    const failureResponse = new Response(null, { status: 401 });

    assert.equal(
      didSignInSucceed(failureResponse),
      false,
      "HTTP 401 responses must surface a failed login state",
    );
  });

  test("treats redirects back to the login page as failures", () => {
    assert.equal(
      didSignInSucceed("/login?error=CredentialsSignin"),
      false,
      "Redirects to the sign-in page should not be considered successful",
    );

    const redirectResponse = new Response(null, {
      status: 200,
      headers: { Location: "http://localhost:3000/login?callbackUrl=%2F" },
    });

    assert.equal(
      didSignInSucceed(redirectResponse),
      false,
      "Login redirects from responses should mark the attempt as failed",
    );

    assert.equal(
      didSignInSucceed({ ok: true, url: "/login" }),
      false,
      "Objects pointing to the login route should be treated as failures",
    );
  });
});

test.describe("extractRedirectPath", () => {
  const baseUrl = "http://localhost:3000";

  test("ignores redirects back to the login page", () => {
    const redirect = extractRedirectPath("/login?callbackUrl=%2F", { baseUrl });

    assert.equal(
      redirect,
      undefined,
      "Successful submissions should not loop back to the login route",
    );
  });

  test("normalises absolute URLs returned by NextAuth", () => {
    const response = new Response(null, {
      status: 200,
      headers: { Location: "http://localhost:3000/chat/abc123" },
    });

    const redirect = extractRedirectPath(response, { baseUrl });

    assert.equal(redirect, "/chat/abc123");
  });
});
