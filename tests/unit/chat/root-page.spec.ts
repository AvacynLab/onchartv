import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocked redirect helper mirroring Next.js behaviour. We throw to emulate the
 * framework short-circuiting rendering once a redirect is triggered.
 */
const redirectMock = vi.fn();

/**
 * Mocked auth provider returning a session depending on the scenario under
 * test. Each case resets the mock so assertions stay isolated.
 */
const authMock = vi.fn<[], Promise<Session | null>>();

/**
 * Nested chat page mock. The root page should delegate rendering to this
 * component once it has validated the session.
 */
const chatPageMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: authMock,
}));

vi.mock("@/app/(chat)/chat/page", () => ({
  __esModule: true,
  default: chatPageMock,
}));

describe("app/(chat)/page", () => {
  const importPage = async () => {
    const module = await import("@/app/(chat)/page");
    return module.default;
  };

  beforeEach(() => {
    vi.resetModules();
    redirectMock.mockReset();
    authMock.mockReset();
    chatPageMock.mockReset();
  });

  it("redirects guests to /login", async () => {
    authMock.mockResolvedValue(null);
    redirectMock.mockImplementation(() => {
      throw new Error("redirect");
    });

    const Page = await importPage();

    await expect(Page()).rejects.toThrow("redirect");
    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(chatPageMock).not.toHaveBeenCalled();
  });

  it("redirects non-regular accounts to /login", async () => {
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
    redirectMock.mockImplementation(() => {
      throw new Error("redirect");
    });

    const Page = await importPage();

    await expect(Page()).rejects.toThrow("redirect");
    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(chatPageMock).not.toHaveBeenCalled();
  });

  it("delegates rendering when the session is regular", async () => {
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
    const Page = await importPage();
    const result = await Page();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      props: {
        prefetchedSession: regularSession,
      },
      type: chatPageMock,
    });
  });
});
