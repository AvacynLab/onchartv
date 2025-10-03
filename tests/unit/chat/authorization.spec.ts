import { describe, expect, it } from "vitest";

import type { Session } from "next-auth";

import { assertRegularChatUser } from "@/lib/chat/authorization";
import { ChatSDKError } from "@/lib/errors";

describe("assertRegularChatUser", () => {
  it("throws an unauthorized error when the session is missing", () => {
    expect(() => assertRegularChatUser(null)).toThrowError(ChatSDKError);

    try {
      assertRegularChatUser(null);
    } catch (error) {
      if (error instanceof ChatSDKError) {
        expect(error.statusCode).toBe(401);
        expect(error.message).toContain("sign in");
      }
    }
  });

  it("throws a forbidden error when the user is not regular", () => {
    const session = {
      user: {
        id: "guest-1",
        type: "guest" as const,
        email: "guest@example.com",
        name: "Guest",
        image: null,
      },
      expires: new Date(Date.now() + 1_000).toISOString(),
    } satisfies Session;

    expect(() => assertRegularChatUser(session)).toThrowError(ChatSDKError);

    try {
      assertRegularChatUser(session);
    } catch (error) {
      if (error instanceof ChatSDKError) {
        expect(error.statusCode).toBe(403);
        expect(error.message).toContain("regular account");
      }
    }
  });

  it("returns the user when the session belongs to a regular account", () => {
    const session = {
      user: {
        id: "user-123",
        type: "regular" as const,
        email: "user@example.com",
        name: "Demo User",
        image: null,
      },
      expires: new Date(Date.now() + 1_000).toISOString(),
    } satisfies Session;

    const user = assertRegularChatUser(session);

    expect(user.id).toBe("user-123");
    expect(user.type).toBe("regular");
  });
});
