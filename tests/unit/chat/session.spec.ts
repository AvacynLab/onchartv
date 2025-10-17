import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn<[], Promise<Session | null>>();

describe("app/(chat)/session", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
  });

  const importModule = async () => {
    vi.doMock("@/app/(auth)/auth", () => ({
      auth: authMock,
    }));

    return import("@/app/(chat)/session");
  };

  it("returns null when no session is available", async () => {
    authMock.mockResolvedValue(null);
    const { requireRegularChatSession } = await importModule();

    await expect(requireRegularChatSession()).resolves.toBeNull();
    expect(authMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for non-regular accounts", async () => {
    const guestSession = {
      user: {
        id: "guest-1",
        type: "guest" as const,
        email: "guest@example.com",
        name: "Guest User",
        image: null,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } satisfies Session;

    authMock.mockResolvedValue(guestSession);
    const { requireRegularChatSession } = await importModule();

    await expect(requireRegularChatSession()).resolves.toBeNull();
    expect(authMock).toHaveBeenCalledTimes(1);
  });

  it("returns the regular session for authorised users", async () => {
    const regularSession = {
      user: {
        id: "user-42",
        type: "regular" as const,
        email: "user42@example.com",
        name: "Regular User",
        image: null,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } satisfies Session;

    authMock.mockResolvedValue(regularSession);
    const { requireRegularChatSession } = await importModule();

    await expect(requireRegularChatSession()).resolves.toStrictEqual(regularSession);
    expect(authMock).toHaveBeenCalledTimes(1);
  });
});
