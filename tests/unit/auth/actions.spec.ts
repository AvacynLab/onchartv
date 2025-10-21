import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoginActionState, RegisterActionState } from "@/app/(auth)/actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

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
  createInitialChat: vi.fn(),
}));

const signIn = vi.mocked((await import("@/app/(auth)/auth")).signIn);
const { didSignInSucceed, extractRedirectPath } = vi.mocked(
  await import("@/lib/auth/sign-in-response")
);
const { getUser, createUser, createInitialChat } = vi.mocked(
  await import("@/lib/db/queries")
);
const { revalidatePath } = vi.mocked(await import("next/cache"));
const { login, register } = await import("@/app/(auth)/actions");

describe("auth actions", () => {
  beforeEach(() => {
    signIn.mockResolvedValue({ ok: true } as any);
    didSignInSucceed.mockReturnValue(true);
    extractRedirectPath.mockReturnValue(null);
    getUser.mockResolvedValue([undefined]);
    createUser.mockResolvedValue(undefined);
    createInitialChat.mockResolvedValue({
      chatId: "chat-123",
      messageId: "message-123",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      title: "Welcome",
    });
    revalidatePath.mockClear();
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

  it("seeds an onboarding chat and redirects to the seeded conversation when the user lookup succeeds", async () => {
    const formData = new FormData();
    formData.set("email", "fresh@example.com");
    formData.set("password", "S3cure!");

    getUser.mockResolvedValueOnce([undefined as any]);
    getUser.mockResolvedValueOnce([{ id: "user-id" }] as any);

    const result = await register({ status: "idle" } satisfies RegisterActionState, formData);

    expect(createInitialChat).toHaveBeenCalledWith({ userId: "user-id" });
    expect(revalidatePath).toHaveBeenCalledWith("/chat");
    expect(revalidatePath).toHaveBeenCalledWith("/chat/chat-123");
    expect(result).toEqual({ status: "success", redirectTo: "/chat/chat-123" });
  });
});
