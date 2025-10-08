import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoginActionState, RegisterActionState } from "@/app/(auth)/actions";

vi.mock("@/app/(auth)/auth", () => ({
  signIn: vi.fn(),
}));

vi.mock("@/lib/auth/sign-in-response", () => ({
  didSignInSucceed: vi.fn(),
  extractRedirectPath: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  getUser: vi.fn(),
  createUser: vi.fn(),
}));

const signIn = vi.mocked((await import("@/app/(auth)/auth")).signIn);
const { didSignInSucceed, extractRedirectPath } = vi.mocked(
  await import("@/lib/auth/sign-in-response")
);
const { getUser, createUser } = vi.mocked(await import("@/lib/db/queries"));
const { login, register } = await import("@/app/(auth)/actions");

describe("auth actions", () => {
  beforeEach(() => {
    signIn.mockResolvedValue({ ok: true } as any);
    didSignInSucceed.mockReturnValue(true);
    extractRedirectPath.mockReturnValue(null);
    getUser.mockResolvedValue([undefined]);
    createUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects successful logins to the chat dashboard by default", async () => {
    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("password", "P@ssw0rd");

    const result = await login({ status: "idle" } satisfies LoginActionState, formData);

    expect(signIn).toHaveBeenCalledWith("credentials", expect.objectContaining({
      callbackUrl: "/chat",
    }));
    expect(result).toEqual({ status: "success", redirectTo: "/chat" });
  });

  it("redirects new registrations to chat when NextAuth omits a callback", async () => {
    const formData = new FormData();
    formData.set("email", "fresh@example.com");
    formData.set("password", "S3cure!");

    const result = await register({ status: "idle" } satisfies RegisterActionState, formData);

    expect(createUser).toHaveBeenCalledWith("fresh@example.com", "S3cure!");
    expect(signIn).toHaveBeenCalledWith("credentials", expect.objectContaining({
      callbackUrl: "/chat",
    }));
    expect(result).toEqual({ status: "success", redirectTo: "/chat" });
  });
});
