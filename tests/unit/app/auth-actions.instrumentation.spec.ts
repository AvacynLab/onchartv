import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/app/(auth)/auth", () => ({
  signIn: vi.fn(),
}));

vi.mock("@/lib/auth/sign-in-response", () => ({
  didSignInSucceed: vi.fn(),
  extractRedirectPath: vi.fn(() => "/"),
}));

import { login, __summariseSignInResponseForTests } from "@/app/(auth)/actions";
import { didSignInSucceed } from "@/lib/auth/sign-in-response";
import { signIn } from "@/app/(auth)/auth";

describe("login instrumentation", () => {
  beforeEach(() => {
    vi.mocked(didSignInSucceed).mockReset();
    vi.mocked(signIn).mockReset();
  });

  it("logs a structured summary when sign-in fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // Intentionally left blank for assertion-only spy.
    });

    const signInResponse = { ok: false, error: "CredentialsSignin" };

    vi.mocked(signIn).mockResolvedValue(signInResponse);
    vi.mocked(didSignInSucceed).mockReturnValue(false);

    const formData = new FormData();
    formData.set("email", "debug@example.com");
    formData.set("password", "secret123");

    const result = await login({ status: "idle" }, formData);

    expect(result).toEqual({ status: "failed" });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[auth][debug] Failed credentials sign-in",
      expect.objectContaining({
        email: "debug@example.com",
        response: expect.objectContaining({
          kind: "object",
          ok: false,
          error: "CredentialsSignin",
        }),
      })
    );

    consoleSpy.mockRestore();
  });
});

describe("__summariseSignInResponseForTests", () => {
  it("summarises Response instances without exposing bodies", () => {
    const response = new Response(null, { status: 401, statusText: "Unauthorized" });
    const summary = __summariseSignInResponseForTests(response);

    expect(summary).toEqual({
      kind: "response",
      redirected: false,
      status: 401,
      url: "",
    });
  });

  it("captures object metadata while remaining serialisable", () => {
    const summary = __summariseSignInResponseForTests({
      ok: false,
      error: "CredentialsSignin",
      status: 401,
      url: "http://localhost:3000/api/auth/callback/credentials",
      extra: "value",
    });

    expect(summary).toEqual({
      kind: "object",
      keys: ["ok", "error", "status", "url", "extra"],
      ok: false,
      error: "CredentialsSignin",
      status: 401,
      url: "http://localhost:3000/api/auth/callback/credentials",
    });
  });
});
