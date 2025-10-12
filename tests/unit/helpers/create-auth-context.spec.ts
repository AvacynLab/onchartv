import type { Browser, BrowserContext } from "@playwright/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const chatPageStubs = vi.hoisted(() => ({
  createNewChat: vi.fn(),
  getSelectedModel: vi.fn(),
  chooseModelFromSelector: vi.fn(),
}));

const playwrightExpectState = vi.hoisted(() => ({
  calls: [] as {
    args: unknown[];
    matchers: {
      toBeVisible: ReturnType<typeof vi.fn>;
      toBeEnabled: ReturnType<typeof vi.fn>;
      toContainText: ReturnType<typeof vi.fn>;
      resolves: { toEqual: ReturnType<typeof vi.fn> };
    };
  }[],
}));

vi.mock("../../pages/chat", () => ({
  __esModule: true,
  ChatPage: class {
    constructor() {}

    createNewChat = chatPageStubs.createNewChat;
    getSelectedModel = chatPageStubs.getSelectedModel;
    chooseModelFromSelector = chatPageStubs.chooseModelFromSelector;
  },
}));

vi.mock("@/lib/ai/models", () => ({
  __esModule: true,
  chatModels: [
    { id: "chat-model", name: "GPT-4o mini" },
    { id: "chat-model-reasoning", name: "Grok Reasoning" },
  ],
}));

vi.mock("@playwright/test", () => ({
  __esModule: true,
  expect: (...args: unknown[]) => {
    const matchers = {
      toBeVisible: vi.fn().mockResolvedValue(undefined),
      toBeEnabled: vi.fn().mockResolvedValue(undefined),
      toContainText: vi.fn().mockResolvedValue(undefined),
      resolves: {
        toEqual: vi.fn().mockResolvedValue(undefined),
      },
    };

    playwrightExpectState.calls.push({ args, matchers });
    return matchers;
  },
}));

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  __esModule: true,
  default: fsMocks,
  ...fsMocks,
}));

const existsSyncMock = fsMocks.existsSync;

type HelpersModule = typeof import("../../helpers");

let signInPlaywrightUser: HelpersModule["signInPlaywrightUser"];
let tryRestoreSessionFromStorage: HelpersModule["tryRestoreSessionFromStorage"];
let createAuthenticatedContext: HelpersModule["createAuthenticatedContext"];

beforeAll(async () => {
  const helpersModule = await import("../../helpers");
  ({
    signInPlaywrightUser,
    tryRestoreSessionFromStorage,
    createAuthenticatedContext,
  } = helpersModule);
});

beforeEach(() => {
  chatPageStubs.createNewChat.mockReset();
  chatPageStubs.getSelectedModel.mockReset();
  chatPageStubs.chooseModelFromSelector.mockReset();
  playwrightExpectState.calls.length = 0;
});

describe("tryRestoreSessionFromStorage", () => {
  afterEach(() => {
    existsSyncMock.mockReset();
    vi.clearAllMocks();
  });

  it("reuses a stored session when the server confirms the user", async () => {
    existsSyncMock.mockReturnValue(true);

    const newPage = vi.fn().mockResolvedValue({ close: vi.fn() });
    const requestGet = vi.fn().mockResolvedValue({
      ok: () => true,
      json: async () => ({ user: { email: "test-user@example.com" } }),
    });
    const close = vi.fn().mockResolvedValue(undefined);

    const browser = {
      newContext: vi.fn().mockResolvedValue({
        request: { get: requestGet },
        newPage,
        close,
      }),
    } as unknown as Browser;

    const restored = await tryRestoreSessionFromStorage({
      baseURL: "http://127.0.0.1:3100",
      browser,
      expectedEmail: "test-user@example.com",
      storageStatePath: "/tmp/state.json",
    });

    expect(restored).not.toBeNull();
    expect(requestGet).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/auth/session"
    );
    expect(newPage).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("falls back to UI auth when the stored session belongs to another user", async () => {
    existsSyncMock.mockReturnValue(true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const close = vi.fn().mockResolvedValue(undefined);

    const browser = {
      newContext: vi.fn().mockResolvedValue({
        request: {
          get: vi.fn().mockResolvedValue({
            ok: () => true,
            json: async () => ({ user: { email: "other@example.com" } }),
          }),
        },
        newPage: vi.fn(),
        close,
      }),
    } as unknown as Browser;

    const restored = await tryRestoreSessionFromStorage({
      baseURL: "http://127.0.0.1:3100",
      browser,
      expectedEmail: "test-user@example.com",
      storageStatePath: "/tmp/state.json",
    });

    expect(restored).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("skips reuse entirely when there is no stored state", async () => {
    existsSyncMock.mockReturnValue(false);

    const browser = {
      newContext: vi.fn(),
    } as unknown as Browser;

    const restored = await tryRestoreSessionFromStorage({
      baseURL: "http://127.0.0.1:3100",
      browser,
      expectedEmail: "test-user@example.com",
      storageStatePath: "/tmp/state.json",
    });

    expect(restored).toBeNull();
    expect(browser.newContext).not.toHaveBeenCalled();
  });
});

describe("signInPlaywrightUser", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const baseURL = "http://127.0.0.1:3100";
  const email = "playwright@example.com";
  const password = "secret";

  it("performs a credentials sign-in and waits for the session", async () => {
    const post = vi.fn().mockResolvedValue({
      status: () => 200,
      text: async () => "",
    });

    const get = vi
      .fn()
      .mockResolvedValueOnce({
        ok: () => true,
        json: async () => ({ csrfToken: "token" }),
      })
      .mockResolvedValueOnce({
        ok: () => true,
        json: async () => ({ user: { email } }),
      });

    const context = {
      request: { get, post },
    } as unknown as BrowserContext;

    await signInPlaywrightUser({
      baseURL,
      context,
      email,
      password,
      sessionPollIntervalMs: 1,
      sessionPollTimeoutMs: 25,
    });

    expect(post).toHaveBeenCalledWith(
      `${baseURL}/api/auth/callback/credentials`,
      expect.objectContaining({
        form: expect.objectContaining({ email, password }),
      })
    );

    expect(get).toHaveBeenLastCalledWith(`${baseURL}/api/auth/session`);
  });

  it("throws when the CSRF endpoint fails", async () => {
    const context = {
      request: {
        get: vi.fn().mockResolvedValue({
          ok: () => false,
          status: () => 500,
          text: async () => "no csrf",
        }),
        post: vi.fn(),
      },
    } as unknown as BrowserContext;

    await expect(
      signInPlaywrightUser({
        baseURL,
        context,
        email,
        password,
        sessionPollIntervalMs: 1,
        sessionPollTimeoutMs: 5,
      })
    ).rejects.toThrow(/Failed to retrieve CSRF token/);
  });

  it("times out when the session never matches the target email", async () => {
    const post = vi.fn().mockResolvedValue({
      status: () => 200,
      text: async () => "",
    });

    const get = vi
      .fn()
      .mockResolvedValueOnce({
        ok: () => true,
        json: async () => ({ csrfToken: "token" }),
      })
      .mockResolvedValue({
        ok: () => true,
        json: async () => ({ user: { email: "someone-else@example.com" } }),
      });

    const context = {
      request: { get, post },
    } as unknown as BrowserContext;

    await expect(
      signInPlaywrightUser({
        baseURL,
        context,
        email,
        password,
        sessionPollIntervalMs: 1,
        sessionPollTimeoutMs: 5,
      })
    ).rejects.toThrow(/Timed out waiting/);
  });

  it("retries transient sign-in transport failures before succeeding", async () => {
    const setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((handler: (...args: any[]) => void) => {
        handler();
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout);

    try {
      const post = vi
        .fn()
        .mockRejectedValueOnce(new Error("read ECONNRESET"))
        .mockResolvedValue({
          status: () => 302,
          text: async () => "",
        });

      const get = vi
        .fn()
        .mockResolvedValueOnce({
          ok: () => true,
          json: async () => ({ csrfToken: "token" }),
        })
        .mockResolvedValueOnce({
          ok: () => true,
          json: async () => ({ user: { email } }),
        });

      const context = {
        request: { get, post },
      } as unknown as BrowserContext;

      const waitPromise = signInPlaywrightUser({
        baseURL,
        context,
        email,
        password,
        sessionPollIntervalMs: 1,
        sessionPollTimeoutMs: 25,
      });

      await expect(waitPromise).resolves.toBeUndefined();

      expect(post).toHaveBeenCalledTimes(2);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("throws a descriptive error after exhausting sign-in retries", async () => {
    const setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((handler: (...args: any[]) => void) => {
        handler();
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout);

    try {
      const post = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

      const get = vi
        .fn()
        .mockResolvedValueOnce({
          ok: () => true,
          json: async () => ({ csrfToken: "token" }),
        });

      const context = {
        request: { get, post },
      } as unknown as BrowserContext;

      const waitPromise = signInPlaywrightUser({
        baseURL,
        context,
        email,
        password,
        sessionPollIntervalMs: 1,
        sessionPollTimeoutMs: 5,
      });

      const guardedPromise = waitPromise.catch((error) => {
        throw error;
      });

      await expect(guardedPromise).rejects.toThrow(
        /Playwright credentials sign-in failed after 3 attempts/
      );

      expect(post).toHaveBeenCalledTimes(3);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});

describe("createAuthenticatedContext", () => {
  afterEach(() => {
    existsSyncMock.mockReset();
    fsMocks.mkdirSync.mockReset();
    fsMocks.writeFileSync.mockReset();
  });

  it("applies a preferred chat model cookie when provided", async () => {
    existsSyncMock.mockReturnValue(false);

    const expectedEmail = "test-curie-e2e@playwright.com";

    const requestGet = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/api/auth/csrf")) {
        return Promise.resolve({
          ok: () => true,
          json: async () => ({ csrfToken: "token" }),
        });
      }

      if (url.endsWith("/api/auth/session")) {
        return Promise.resolve({
          ok: () => true,
          json: async () => ({ user: { email: expectedEmail } }),
        });
      }

      return Promise.resolve({
        ok: () => false,
        json: async () => ({}),
      });
    });

    const requestPost = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/tests/auth/register")) {
        return Promise.resolve({
          ok: () => true,
          status: () => 201,
          text: async () => "",
        });
      }

      return Promise.resolve({
        ok: () => true,
        status: () => 200,
        text: async () => "",
      });
    });

    const firstPage = {
      getByPlaceholder: vi.fn().mockReturnValue({}),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const addCookies = vi.fn().mockResolvedValue(undefined);
    const storageState = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    const firstContext = {
      request: { get: requestGet, post: requestPost },
      addCookies,
      newPage: vi.fn().mockResolvedValue(firstPage),
      storageState,
      close,
    };

    const secondPage = {};
    const secondContext = {
      newPage: vi.fn().mockResolvedValue(secondPage),
      request: {},
    };

    const browser = {
      newContext: vi
        .fn()
        .mockResolvedValueOnce(firstContext)
        .mockResolvedValueOnce(secondContext),
    } as unknown as Browser;

    chatPageStubs.createNewChat.mockResolvedValue(undefined);
    chatPageStubs.getSelectedModel.mockResolvedValue("Grok Reasoning");
    chatPageStubs.chooseModelFromSelector.mockResolvedValue(undefined);

    const result = await createAuthenticatedContext({
      browser,
      name: "curie-e2e",
      preferredChatModelId: "chat-model-reasoning",
    });

    expect(requestPost).toHaveBeenCalledWith(
      expect.stringContaining("/api/tests/auth/register"),
      expect.objectContaining({ data: expect.any(Object) })
    );
    expect(requestGet).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/csrf")
    );
    expect(addCookies).toHaveBeenCalledWith([
      {
        name: "chat-model",
        value: "chat-model-reasoning",
        url: "http://localhost:3100/",
      },
    ]);
    expect(chatPageStubs.chooseModelFromSelector).not.toHaveBeenCalled();
    expect(result.context).toBe(secondContext);
    expect(result.page).toBe(secondPage);

  });

  it("falls back to the selector when the cookie preload mismatches", async () => {
    existsSyncMock.mockReturnValue(false);

    const expectedEmail = "test-curie-e2e@playwright.com";

    const requestGet = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/api/auth/csrf")) {
        return Promise.resolve({
          ok: () => true,
          json: async () => ({ csrfToken: "token" }),
        });
      }

      if (url.endsWith("/api/auth/session")) {
        return Promise.resolve({
          ok: () => true,
          json: async () => ({ user: { email: expectedEmail } }),
        });
      }

      return Promise.resolve({
        ok: () => false,
        json: async () => ({}),
      });
    });

    const requestPost = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/tests/auth/register")) {
        return Promise.resolve({
          ok: () => true,
          status: () => 201,
          text: async () => "",
        });
      }

      return Promise.resolve({
        ok: () => true,
        status: () => 200,
        text: async () => "",
      });
    });

    const firstPage = {
      getByPlaceholder: vi.fn().mockReturnValue({}),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const addCookies = vi.fn().mockResolvedValue(undefined);
    const storageState = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    const firstContext = {
      request: { get: requestGet, post: requestPost },
      addCookies,
      newPage: vi.fn().mockResolvedValue(firstPage),
      storageState,
      close,
    };

    const secondPage = {};
    const secondContext = {
      newPage: vi.fn().mockResolvedValue(secondPage),
      request: {},
    };

    const browser = {
      newContext: vi
        .fn()
        .mockResolvedValueOnce(firstContext)
        .mockResolvedValueOnce(secondContext),
    } as unknown as Browser;

    chatPageStubs.createNewChat.mockResolvedValue(undefined);
    chatPageStubs.getSelectedModel
      .mockResolvedValueOnce("GPT-4o mini")
      .mockResolvedValue("Grok Reasoning");
    chatPageStubs.chooseModelFromSelector.mockResolvedValue(undefined);

    const result = await createAuthenticatedContext({
      browser,
      name: "curie-e2e",
      preferredChatModelId: "chat-model-reasoning",
    });

    expect(requestPost).toHaveBeenCalledWith(
      expect.stringContaining("/api/tests/auth/register"),
      expect.objectContaining({ data: expect.any(Object) })
    );
    expect(requestGet).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/csrf")
    );
    expect(addCookies).toHaveBeenCalled();
    expect(chatPageStubs.chooseModelFromSelector).toHaveBeenCalledWith(
      "chat-model-reasoning"
    );

    const resolveCall = playwrightExpectState.calls.find((call) => {
      const candidate = call.args[0] as unknown;
      return typeof candidate === "object" && candidate !== null && "then" in candidate;
    });
    expect(resolveCall?.matchers.resolves.toEqual).toHaveBeenCalledWith(
      "Grok Reasoning"
    );
    expect(result.context).toBe(secondContext);
    expect(result.page).toBe(secondPage);

  });

  it("skips cookie injection when no preference is provided", async () => {
    existsSyncMock.mockReturnValue(false);

    const expectedEmail = "test-ada-e2e@playwright.com";

    const requestGet = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/api/auth/csrf")) {
        return Promise.resolve({
          ok: () => true,
          json: async () => ({ csrfToken: "token" }),
        });
      }

      if (url.endsWith("/api/auth/session")) {
        return Promise.resolve({
          ok: () => true,
          json: async () => ({ user: { email: expectedEmail } }),
        });
      }

      return Promise.resolve({
        ok: () => false,
        json: async () => ({}),
      });
    });

    const requestPost = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/tests/auth/register")) {
        return Promise.resolve({
          ok: () => true,
          status: () => 201,
          text: async () => "",
        });
      }

      return Promise.resolve({
        ok: () => true,
        status: () => 200,
        text: async () => "",
      });
    });

    const firstPage = {
      getByPlaceholder: vi.fn().mockReturnValue({}),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const addCookies = vi.fn().mockResolvedValue(undefined);
    const storageState = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    const firstContext = {
      request: { get: requestGet, post: requestPost },
      addCookies,
      newPage: vi.fn().mockResolvedValue(firstPage),
      storageState,
      close,
    };

    const secondPage = {};
    const secondContext = {
      newPage: vi.fn().mockResolvedValue(secondPage),
      request: {},
    };

    const browser = {
      newContext: vi
        .fn()
        .mockResolvedValueOnce(firstContext)
        .mockResolvedValueOnce(secondContext),
    } as unknown as Browser;

    chatPageStubs.createNewChat.mockResolvedValue(undefined);
    chatPageStubs.getSelectedModel.mockResolvedValue("GPT-4o mini");
    chatPageStubs.chooseModelFromSelector.mockResolvedValue(undefined);

    const result = await createAuthenticatedContext({
      browser,
      name: "ada-e2e",
    });

    expect(requestPost).toHaveBeenCalledWith(
      expect.stringContaining("/api/tests/auth/register"),
      expect.objectContaining({ data: expect.any(Object) })
    );
    expect(requestGet).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/csrf")
    );
    expect(addCookies).not.toHaveBeenCalled();
    expect(chatPageStubs.chooseModelFromSelector).not.toHaveBeenCalled();
    expect(result.context).toBe(secondContext);
    expect(result.page).toBe(secondPage);

  });

  it("retries registration when the test endpoint resets the socket", async () => {
    existsSyncMock.mockReturnValue(false);

    const expectedEmail = "test-retry@playwright.com";

    const requestGet = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/api/auth/csrf")) {
        return Promise.resolve({
          ok: () => true,
          json: async () => ({ csrfToken: "token" }),
        });
      }

      if (url.endsWith("/api/auth/session")) {
        return Promise.resolve({
          ok: () => true,
          json: async () => ({ user: { email: expectedEmail } }),
        });
      }

      return Promise.resolve({
        ok: () => false,
        json: async () => ({}),
      });
    });

    let registerAttempts = 0;
    const requestPost = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/tests/auth/register")) {
        registerAttempts += 1;

        if (registerAttempts === 1) {
          return Promise.reject(new Error("ECONNRESET"));
        }

        return Promise.resolve({
          ok: () => true,
          status: () => 201,
          text: async () => "",
        });
      }

      return Promise.resolve({
        ok: () => true,
        status: () => 200,
        text: async () => "",
      });
    });

    const firstPage = {
      getByPlaceholder: vi.fn().mockReturnValue({}),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const storageState = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    const firstContext = {
      request: { get: requestGet, post: requestPost },
      newPage: vi.fn().mockResolvedValue(firstPage),
      storageState,
      close,
    };

    const secondPage = {};
    const secondContext = {
      newPage: vi.fn().mockResolvedValue(secondPage),
      request: {},
    };

    const browser = {
      newContext: vi
        .fn()
        .mockResolvedValueOnce(firstContext)
        .mockResolvedValueOnce(secondContext),
    } as unknown as Browser;

    chatPageStubs.createNewChat.mockResolvedValue(undefined);
    chatPageStubs.getSelectedModel.mockResolvedValue("GPT-4o mini");
    chatPageStubs.chooseModelFromSelector.mockResolvedValue(undefined);

    const result = await createAuthenticatedContext({
      browser,
      name: "retry",
    });

    expect(registerAttempts).toBe(2);
    expect(result.context).toBe(secondContext);
    expect(result.page).toBe(secondPage);
  });

  it("throws after exhausting registration retries", async () => {
    existsSyncMock.mockReturnValue(false);

    const requestGet = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/api/auth/csrf")) {
        return Promise.resolve({
          ok: () => true,
          json: async () => ({ csrfToken: "token" }),
        });
      }

      return Promise.resolve({
        ok: () => false,
        json: async () => ({}),
      });
    });

    let registerAttempts = 0;
    const requestPost = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/tests/auth/register")) {
        registerAttempts += 1;
        return Promise.reject(new Error("ECONNRESET"));
      }

      return Promise.resolve({
        ok: () => true,
        status: () => 200,
        text: async () => "",
      });
    });

    const firstContext = {
      request: { get: requestGet, post: requestPost },
      newPage: vi.fn(),
      storageState: vi.fn(),
      close: vi.fn(),
    };

    const browser = {
      newContext: vi.fn().mockResolvedValue(firstContext),
    } as unknown as Browser;

    await expect(
      createAuthenticatedContext({
        browser,
        name: "retry-failure",
      })
    ).rejects.toThrow(/after 3 attempts: ECONNRESET/);

    expect(requestPost).toHaveBeenCalledTimes(3);
  });
});
