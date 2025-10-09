import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { chatModels } from "@/lib/ai/models";

import { ChatPage } from "../../pages/chat";

type MockResponseOptions = {
  url: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: string;
  method?: string;
};

const createMockResponse = ({
  url,
  ok,
  status,
  statusText,
  body,
  method = "POST",
}: MockResponseOptions) => ({
  url: () => url,
  ok: () => ok,
  status: () => status ?? (ok ? 200 : 500),
  statusText: () => statusText ?? (ok ? "OK" : "Internal Server Error"),
  text: vi.fn().mockResolvedValue(body ?? ""),
  request: () => ({
    method: () => method,
    url: () => url,
  }),
});

type MockResponse = ReturnType<typeof createMockResponse>;

const createSendButtonLocator = (
  implementation: () => boolean | Promise<boolean> = () => false
) => {
  const isDisabled = vi.fn().mockImplementation(() => {
    const result = implementation();
    return result instanceof Promise ? result : Promise.resolve(result);
  });

  return {
    first: vi.fn().mockReturnValue({ isDisabled }),
  } as unknown as ReturnType<Page["getByTestId"]>;
};

describe("ChatPage navigation", () => {
  it("navigates directly to /chat and waits for the chat controls", async () => {
    let currentUrl = "http://localhost:3000/chat";
    const goto = vi.fn().mockImplementation(async () => {
      currentUrl = "http://localhost:3000/chat";
    });
    const waitForSelector = vi.fn().mockResolvedValue(undefined);

    const chatPage = new ChatPage({
      goto: goto as unknown as Page["goto"],
      waitForSelector: waitForSelector as unknown as Page["waitForSelector"],
      url: () => currentUrl,
    } as unknown as Page);

    await chatPage.createNewChat();

    expect(goto).toHaveBeenCalledWith("/chat", { waitUntil: "domcontentloaded" });
    expect(waitForSelector).toHaveBeenCalledWith(
      '[data-testid="multimodal-input"]',
      expect.objectContaining({ state: "visible", timeout: 15_000 })
    );
    expect(waitForSelector).toHaveBeenCalledWith(
      '[data-testid="send-button"]',
      expect.objectContaining({ state: "visible", timeout: 15_000 })
    );
  });

  it("throws when the navigation falls back to /login", async () => {
    let currentUrl = "http://localhost:3000/login";
    const goto = vi.fn().mockImplementation(async () => {
      currentUrl = "http://localhost:3000/login";
    });
    const waitForSelector = vi.fn();

    const chatPage = new ChatPage({
      goto: goto as unknown as Page["goto"],
      waitForSelector: waitForSelector as unknown as Page["waitForSelector"],
      url: () => currentUrl,
    } as unknown as Page);

    await expect(chatPage.createNewChat()).rejects.toThrow(
      /redirected to \/login/
    );
    expect(waitForSelector).not.toHaveBeenCalled();
  });
});

describe("ChatPage.waitForChatApiResponse", () => {
  const createEventHarness = () => {
    const listeners: Record<string, Set<(...args: any[]) => unknown>> = {
      response: new Set(),
      requestfailed: new Set(),
    };

    const page = {
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        listeners[event]?.add(handler);
      }),
      off: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        listeners[event]?.delete(handler);
      }),
      getByTestId: vi.fn((testId: string) => {
        if (testId === "send-button") {
          return createSendButtonLocator();
        }

        throw new Error(`Unexpected test id access: ${testId}`);
      }),
      waitForFunction: vi.fn(),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } satisfies Partial<Page>;

    const emit = async (event: "response" | "requestfailed", payload: any) => {
      for (const handler of Array.from(listeners[event] ?? [])) {
        await handler(payload);
      }
    };

    return {
      page: page as Page,
      emitResponse: (payload: any) => emit("response", payload),
      emitFailure: (payload: any) => emit("requestfailed", payload),
      listeners,
    };
  };

  it("resolves once POST /api/chat responds, including query parameters", async () => {
    vi.useFakeTimers();
    let fallbackSpy: ReturnType<typeof vi.spyOn> | null = null;
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      expect(harness.listeners.response.size).toBe(1);
      expect(harness.listeners.requestfailed.size).toBe(1);

      await harness.emitResponse(
        createMockResponse({
          url: "http://localhost:3000/api/chat?chatId=abc",
          ok: true,
        })
      );

      await expect(waitPromise).resolves.toBeUndefined();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("accepts streaming endpoints under /api/chat/:id/stream", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitResponse(
        createMockResponse({
          url: "http://localhost:3000/api/chat/fake-id/stream",
          ok: true,
        })
      );

      await expect(waitPromise).resolves.toBeUndefined();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("throws with diagnostic details when the chat API rejects", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitResponse(
        createMockResponse({
          url: "http://localhost:3000/api/chat",
          ok: false,
          status: 403,
          statusText: "Forbidden",
          body: "forbidden:chat",
        })
      );

      await expect(waitPromise).rejects.toThrow(
        "Chat API request failed with 403 Forbidden – forbidden:chat"
      );
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("throws when the chat request fails before any response is available", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitFailure({
        method: () => "POST",
        url: () => "http://localhost:3000/api/chat",
        failure: () => ({ errorText: "net::ERR_ABORTED" }),
      });

      await expect(waitPromise).rejects.toThrow(
        "Chat API request failed before receiving a response – net::ERR_ABORTED"
      );
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("falls back to UI polling when the network error indicates an offline transport", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolveToast: (() => void) | null = null;
    let rejectToast: ((reason?: unknown) => void) | null = null;
    try {
      const toastWaitFor = vi.fn().mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            resolveToast = resolve;
            rejectToast = reject;
          })
      );
      const toastInnerText = vi.fn().mockResolvedValue("");
      const harness = createEventHarness();
      (harness.page.getByTestId as ReturnType<typeof vi.fn>).mockImplementation(
        (testId: string) => {
          if (testId === "toast") {
            return {
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "send-button") {
            return createSendButtonLocator(() => false);
          }

          throw new Error(`Unexpected test id ${testId}`);
        }
      );

      const chatPage = new ChatPage(harness.page);
      (chatPage as any).pendingAssistantSnapshot = {
        count: 0,
        latestArtifactCount: 0,
        latestMessageId: null,
        latestMessageText: "",
        userCount: 0,
        latestUserMessageId: null,
        latestUserMessageText: "",
      };

      const pollSpy = vi
        .spyOn(chatPage as any, "pollForStreamingChange")
        .mockResolvedValue(true);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitFailure({
        method: () => "POST",
        url: () => "http://localhost:3000/api/chat",
        failure: () => ({ errorText: "net::ENETUNREACH" }),
      });

      await expect(waitPromise).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        "Chat API network request failed in offline mode; falling back to UI polling.",
        expect.objectContaining({
          failure: "net::ENETUNREACH",
          url: "http://localhost:3000/api/chat",
        })
      );
      expect(toastWaitFor).toHaveBeenCalledWith({
        state: "visible",
        timeout: 90_000,
      });
      expect(pollSpy).toHaveBeenCalledWith({
        baseline: {
          count: 0,
          latestArtifactCount: 0,
          latestMessageId: null,
          latestMessageText: "",
          userCount: 0,
          latestUserMessageId: null,
          latestUserMessageText: "",
        },
        timeoutMs: 90_000,
      });
    } finally {
      rejectToast?.(new Error("toast cleanup"));
      warnSpy.mockRestore();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("falls back to UI guards when no network events fire", async () => {
    vi.useFakeTimers();
    let resolveToast: (() => void) | null = null;
    let rejectToast: ((reason?: unknown) => void) | null = null;
    try {
      const toastWaitFor = vi.fn().mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            resolveToast = resolve;
            rejectToast = reject;
          })
      );
      const toastInnerText = vi.fn().mockResolvedValue("");
      const assistantCount = vi.fn().mockResolvedValue(0);
      let spinnerCalls = 0;
      const spinnerCount = vi
        .fn()
        .mockImplementation(async () => (spinnerCalls++ === 0 ? 1 : 0));

      const harness = createEventHarness();
      (harness.page.getByTestId as ReturnType<typeof vi.fn>).mockImplementation(
        (testId: string) => {
          if (testId === "toast") {
            return {
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant") {
            return {
              count: assistantCount,
              nth: vi.fn(),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-user") {
            return {
              count: vi.fn().mockResolvedValue(0),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant-loading") {
            return {
              count: spinnerCount,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "stop-button") {
            return {
              count: vi.fn().mockResolvedValue(0),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "send-button") {
            return createSendButtonLocator(() => false);
          }

          throw new Error(`Unexpected test id ${testId}`);
        }
      );

      const chatPage = new ChatPage(harness.page);
      (chatPage as any).pendingAssistantSnapshot = {
        count: 0,
        latestArtifactCount: 0,
        latestMessageId: null,
        latestMessageText: "",
        userCount: 0,
        latestUserMessageId: null,
        latestUserMessageText: "",
      };

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await vi.advanceTimersByTimeAsync(60_000);

      await expect(waitPromise).resolves.toBeUndefined();
      expect(toastWaitFor).toHaveBeenCalledWith({
        state: "visible",
        timeout: 90_000,
      });
      expect(spinnerCount).toHaveBeenCalled();
      expect(assistantCount).toHaveBeenCalled();
      expect(
        (harness.page.getByTestId as ReturnType<typeof vi.fn>).mock.calls
          .flat()
      ).toContain("stop-button");
    } finally {
      resolveToast?.();
      resolveToast = null;
      rejectToast = null;
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("throws a descriptive timeout when the UI never indicates streaming", async () => {
    vi.useFakeTimers();
    let resolveToast: (() => void) | null = null;
    let rejectToast: ((reason?: unknown) => void) | null = null;
    try {
      const toastWaitFor = vi.fn().mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            resolveToast = resolve;
            rejectToast = reject;
          })
      );
      const toastInnerText = vi.fn().mockResolvedValue("");

      const assistantCount = vi.fn().mockResolvedValue(1);
      const latestAssistant = {
        getAttribute: vi.fn().mockResolvedValue("assistant-1"),
        getByTestId: vi.fn().mockReturnValue({
          innerText: vi.fn().mockResolvedValue("Thinking..."),
        }),
        locator: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(0),
        }),
      };
      const spinnerCount = vi.fn().mockResolvedValue(0);

      const harness = createEventHarness();
      (harness.page.getByTestId as ReturnType<typeof vi.fn>).mockImplementation(
        (testId: string) => {
          if (testId === "toast") {
            return {
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant") {
            return {
              count: assistantCount,
              nth: vi.fn().mockReturnValue(latestAssistant),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-user") {
            return {
              count: vi.fn().mockResolvedValue(1),
              nth: vi.fn().mockReturnValue({
                getAttribute: vi.fn().mockResolvedValue("user-1"),
                getByTestId: vi.fn().mockReturnValue({
                  innerText: vi.fn().mockResolvedValue("Initial prompt"),
                }),
              }),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant-loading") {
            return {
              count: spinnerCount,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "stop-button") {
            return { count: vi.fn().mockResolvedValue(0) } as unknown as ReturnType<
              Page["getByTestId"]
            >;
          }

          if (testId === "send-button") {
            return createSendButtonLocator(() => false);
          }

          throw new Error(`Unexpected test id ${testId}`);
        }
      );

      const chatPage = new ChatPage(harness.page);
      /**
       * Simulate a suggestion trigger where the assistant bubble count stays
       * flat but a brand-new user message appears before the streaming
       * skeleton renders. The fallback should treat the user timeline delta as
       * proof that the request is in flight.
       */
      const baselineSnapshot = {
        count: 1,
        latestArtifactCount: 0,
        latestMessageId: "assistant-1",
        latestMessageText: "Thinking...",
        userCount: 1,
        latestUserMessageId: "user-1",
        latestUserMessageText: "Initial prompt",
      } as const;

      const waitPromise = (chatPage as any).waitForUiStreamingFallback(
        baselineSnapshot,
        90_000
      );
      const outcomePromise = waitPromise.then<
        { status: "resolved" } | { status: "rejected"; error: unknown }
      >(
        () => ({ status: "resolved" }),
        (error) => ({ status: "rejected", error })
      );

      await vi.advanceTimersByTimeAsync(90_000);

      const outcome = await outcomePromise;
      expect(outcome.status).toBe("rejected");
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).message).toBe(
        "Timed out waiting for chat UI to start streaming"
      );
      expect(toastWaitFor).toHaveBeenCalledWith({
        state: "visible",
        timeout: 90_000,
      });
      expect(assistantCount).toHaveBeenCalled();
      expect(latestAssistant.getAttribute).toHaveBeenCalled();
      expect(spinnerCount).toHaveBeenCalled();
    } finally {
      resolveToast?.();
      resolveToast = null;
      rejectToast = null;
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("surfaces a descriptive timeout when streaming never begins", async () => {
    vi.useFakeTimers();
    let fallbackSpy: ReturnType<typeof vi.spyOn> | null = null;
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);

      const baselineSnapshot = {
        count: 1,
        latestArtifactCount: 0,
        latestMessageId: "assistant-1",
        latestMessageText: "Thinking...",
        userCount: 1,
        latestUserMessageId: "user-1",
        latestUserMessageText: "Initial prompt",
      } as const;

      (chatPage as any).pendingAssistantSnapshot = baselineSnapshot;

      const fallbackError = new Error(
        "Timed out waiting for chat UI to start streaming"
      );
      fallbackSpy = vi
        .spyOn(chatPage as any, "waitForUiStreamingFallback")
        .mockRejectedValue(fallbackError);

      const waitPromise = (chatPage as any).waitForChatApiResponse();
      const outcomePromise = waitPromise.then<
        { status: "resolved" } | { status: "rejected"; error: unknown }
      >(
        () => ({ status: "resolved" }),
        (error) => ({ status: "rejected", error })
      );

      await vi.advanceTimersByTimeAsync(60_000);

      const outcome = await outcomePromise;
      expect(outcome.status).toBe("rejected");
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).message).toBe(
        "Timed out waiting for chat UI to start streaming"
      );

      expect(fallbackSpy).toHaveBeenCalledWith(baselineSnapshot, 90_000);
    } finally {
      fallbackSpy?.mockRestore();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("detects streaming when a fresh user bubble appears", async () => {
    vi.useFakeTimers();
    let resolveToast: (() => void) | null = null;
    let rejectToast: ((reason?: unknown) => void) | null = null;
    try {
      const toastWaitFor = vi.fn().mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            resolveToast = resolve;
            rejectToast = reject;
          })
      );
      const toastInnerText = vi.fn().mockResolvedValue("");
      const assistantCount = vi.fn().mockResolvedValue(1);
      const spinnerCount = vi.fn().mockResolvedValue(0);
      const stopCount = vi.fn().mockResolvedValue(0);
      const userCount = vi.fn().mockResolvedValue(2);
      const latestUser = {
        getAttribute: vi.fn().mockResolvedValue("user-2"),
        getByTestId: vi.fn().mockImplementation((testId: string) => {
          expect(testId).toBe("message-content");
          return { innerText: vi.fn().mockResolvedValue("New prompt") };
        }),
      };

      const harness = createEventHarness();
      (harness.page.getByTestId as ReturnType<typeof vi.fn>).mockImplementation(
        (testId: string) => {
          if (testId === "toast") {
            return {
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant") {
            return {
              count: assistantCount,
              nth: vi.fn().mockReturnValue({
                getAttribute: vi.fn().mockResolvedValue("assistant-1"),
                getByTestId: vi.fn().mockReturnValue({
                  innerText: vi.fn().mockResolvedValue("Thinking..."),
                }),
                locator: vi.fn().mockReturnValue({
                  count: vi.fn().mockResolvedValue(0),
                }),
              }),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-user") {
            return {
              count: userCount,
              nth: vi.fn().mockReturnValue(latestUser),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant-loading") {
            return { count: spinnerCount } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "stop-button") {
            return { count: stopCount } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "send-button") {
            return createSendButtonLocator(() => false);
          }

          throw new Error(`Unexpected test id ${testId}`);
        }
      );

      const chatPage = new ChatPage(harness.page);
      const baselineSnapshot = {
        count: 1,
        latestArtifactCount: 0,
        latestMessageId: "assistant-1",
        latestMessageText: "Thinking...",
        userCount: 1,
        latestUserMessageId: "user-1",
        latestUserMessageText: "Seed prompt",
      } as const;

      const waitPromise = (chatPage as any).waitForUiStreamingFallback(
        baselineSnapshot,
        5_000
      );

      await expect(waitPromise).resolves.toBeUndefined();
      expect(userCount).toHaveBeenCalled();
      expect(latestUser.getAttribute).not.toHaveBeenCalled();
      expect(latestUser.getByTestId).not.toHaveBeenCalled();
    } finally {
      resolveToast?.();
      resolveToast = null;
      rejectToast = null;
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("detects streaming when the composer disables the send button", async () => {
    vi.useFakeTimers();
    let resolveToast: (() => void) | null = null;
    let rejectToast: ((reason?: unknown) => void) | null = null;
    try {
      const toastWaitFor = vi.fn().mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            resolveToast = resolve;
            rejectToast = reject;
          })
      );
      const toastInnerText = vi.fn().mockResolvedValue("");
      const assistantCount = vi.fn().mockResolvedValue(0);
      const spinnerCount = vi.fn().mockResolvedValue(0);
      const stopCount = vi.fn().mockResolvedValue(0);
      const userCount = vi.fn().mockResolvedValue(0);
      const sendButtonStates = [true];

      const harness = createEventHarness();
      (harness.page.getByTestId as ReturnType<typeof vi.fn>).mockImplementation(
        (testId: string) => {
          if (testId === "toast") {
            return {
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant") {
            return {
              count: assistantCount,
              nth: vi.fn(),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant-loading") {
            return { count: spinnerCount } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "stop-button") {
            return { count: stopCount } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-user") {
            return { count: userCount } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "send-button") {
            return createSendButtonLocator(() => {
              const next = sendButtonStates.shift();
              return typeof next === "boolean" ? next : true;
            });
          }

          throw new Error(`Unexpected test id ${testId}`);
        }
      );

      const chatPage = new ChatPage(harness.page);
      const baselineSnapshot = {
        count: 0,
        latestArtifactCount: 0,
        latestMessageId: null,
        latestMessageText: "",
        userCount: 0,
        latestUserMessageId: null,
        latestUserMessageText: "",
      } as const;

      const waitPromise = (chatPage as any).waitForUiStreamingFallback(
        baselineSnapshot,
        5_000
      );

      await expect(waitPromise).resolves.toBeUndefined();
      expect(assistantCount).toHaveBeenCalled();
      expect(spinnerCount).toHaveBeenCalled();
      expect(stopCount).toHaveBeenCalled();
    } finally {
      resolveToast?.();
      resolveToast = null;
      rejectToast = null;
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});

describe("ChatPage vote helpers", () => {
  /**
   * Build a `Page` stub whose `waitForResponse` resolves with a deterministic
   * mocked Playwright response. The matcher is expected to accept the supplied
   * payload so the helper under test can short-circuit just like Playwright
   * would when the first matching network event arrives.
   */
  const createVotePage = (
    response: {
      ok: boolean;
      status?: number;
      statusText?: string;
      method?: string;
      url?: string;
      postDataJSON?: () => unknown;
    }
  ) => {
    const payload = {
      ok: () => response.ok,
      status: () => response.status ?? (response.ok ? 200 : 500),
      statusText: () =>
        response.statusText ?? (response.ok ? "OK" : "Internal Server Error"),
      url: () => response.url ?? "http://localhost:3000/api/vote",
      request: () => ({
        method: () => response.method ?? "PATCH",
        postDataJSON: response.postDataJSON,
      }),
    };

    const waitForResponse = vi.fn(
      async (
        matcher: (candidate: typeof payload) => boolean,
        options: { timeout?: number }
      ) => {
        expect(options).toEqual({ timeout: 15_000 });
        expect(matcher(payload)).toBe(true);
        return payload;
      }
    );

    return {
      page: { waitForResponse } as unknown as Page,
      waitForResponse,
    };
  };

  it("awaits the matching PATCH /api/vote response and resolves on success", async () => {
    const { page, waitForResponse } = createVotePage({
      ok: true,
      postDataJSON: () => ({ type: "up" }),
    });
    const chatPage = new ChatPage(page);

    await expect(
      (chatPage as any).waitForVoteRequest("up")
    ).resolves.toBeUndefined();
    expect(waitForResponse).toHaveBeenCalledOnce();
  });

  it("throws an explicit error when the vote response is not ok", async () => {
    const { page } = createVotePage({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      postDataJSON: () => ({ type: "down" }),
    });
    const chatPage = new ChatPage(page);

    await expect(
      (chatPage as any).waitForVoteRequest("down")
    ).rejects.toThrow("Vote request failed with 429 Too Many Requests");
  });

  it("accepts bodies that cannot be parsed and still resolves when OK", async () => {
    const { page } = createVotePage({
      ok: true,
      postDataJSON: () => {
        throw new Error("Unexpected body shape");
      },
    });
    const chatPage = new ChatPage(page);

    await expect(
      (chatPage as any).waitForVoteRequest("up")
    ).resolves.toBeUndefined();
  });

  it("waits for the toast, network request, and disabled state when voting succeeds", async () => {
    const voteButton = {
      isDisabled: vi.fn().mockResolvedValue(true),
    };
    const toastWaitFor = vi.fn().mockResolvedValue(undefined);
    const toastToContain = vi.fn().mockResolvedValue(undefined);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      waitForResponse: vi.fn().mockResolvedValue({
        ok: () => true,
        status: () => 200,
        statusText: () => "OK",
        request: () => ({
          method: () => "PATCH",
          postDataJSON: () => ({ type: "up" }),
        }),
        url: () => "http://localhost:3000/api/vote",
      }),
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-upvote") {
          return voteButton as unknown as ReturnType<Page["getByTestId"]>;
        }
        if (testId === "toast") {
          return {
            waitFor: toastWaitFor,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      waitForTimeout,
    } satisfies Partial<Page>;

    const originalExpect = ChatPage.expect;
    ChatPage.expect = vi
      .fn()
      .mockReturnValue({ toContainText: toastToContain } as any) as any;

    try {
      const chatPage = new ChatPage(page as Page);
      const networkSpy = vi.fn();
      (chatPage as any).pendingVoteRequest = Promise.resolve().then(networkSpy);

      await expect(chatPage.isVoteComplete("up")).resolves.toBeUndefined();

      expect(toastWaitFor).toHaveBeenCalledWith({
        state: "visible",
        timeout: 2_000,
      });
      expect(toastToContain).toHaveBeenCalledWith("Upvoted Response!");
      expect(voteButton.isDisabled).toHaveBeenCalledOnce();
      expect(waitForTimeout).not.toHaveBeenCalled();
      expect(networkSpy).toHaveBeenCalledOnce();
      expect((chatPage as any).pendingVoteRequest).toBeNull();
    } finally {
      ChatPage.expect = originalExpect;
    }
  });

  it("falls back to the disabled state when the toast never appears", async () => {
    const voteButton = {
      isDisabled: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const toastWaitFor = vi.fn().mockRejectedValue(new Error("timeout"));
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      waitForResponse: vi.fn().mockResolvedValue({
        ok: () => true,
        status: () => 200,
        statusText: () => "OK",
        request: () => ({
          method: () => "PATCH",
          postDataJSON: () => ({ type: "down" }),
        }),
        url: () => "http://localhost:3000/api/vote",
      }),
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-downvote") {
          return voteButton as unknown as ReturnType<Page["getByTestId"]>;
        }
        if (testId === "toast") {
          return {
            waitFor: toastWaitFor,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }
        throw new Error(`Unexpected test id: ${testId}`);
      }),
      waitForTimeout,
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const networkSpy = vi.fn();
    (chatPage as any).pendingVoteRequest = Promise.resolve().then(networkSpy);

    await expect(chatPage.isVoteComplete("down")).resolves.toBeUndefined();

    expect(toastWaitFor).toHaveBeenCalledWith({
      state: "visible",
      timeout: 2_000,
    });
    expect(voteButton.isDisabled).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalledOnce();
    expect(networkSpy).toHaveBeenCalledOnce();
    expect((chatPage as any).pendingVoteRequest).toBeNull();
  });

  it("propagates failures from the tracked vote request", async () => {
    const voteButton = {
      isDisabled: vi.fn().mockResolvedValue(true),
    };
    const toastWaitFor = vi.fn().mockRejectedValue(new Error("timeout"));
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      waitForResponse: vi.fn().mockResolvedValue({
        ok: () => false,
        status: () => 500,
        statusText: () => "Internal Server Error",
        request: () => ({
          method: () => "PATCH",
          postDataJSON: () => ({ type: "up" }),
        }),
        url: () => "http://localhost:3000/api/vote",
      }),
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-upvote") {
          return voteButton as unknown as ReturnType<Page["getByTestId"]>;
        }
        if (testId === "toast") {
          return {
            waitFor: toastWaitFor,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }
        throw new Error(`Unexpected test id: ${testId}`);
      }),
      waitForTimeout,
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    let rejectVote!: (error: Error) => void;
    const pendingVote = new Promise<void>((_, reject) => {
      rejectVote = reject;
    });
    (chatPage as any).pendingVoteRequest = pendingVote;

    const voteComplete = chatPage.isVoteComplete("up");
    const failure = new Error("Vote request failed with 500 Internal Server Error");
    rejectVote(failure);

    await expect(voteComplete).rejects.toBe(failure);
    expect((chatPage as any).pendingVoteRequest).toBeNull();
  });
});

describe("ChatPage generation helpers", () => {
  it("captures an empty assistant snapshot", async () => {
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const userLocator = {
      count: vi.fn().mockResolvedValue(0),
    };

    const page = {
      getByTestId: vi
        .fn<Page["getByTestId"]>()
        .mockImplementation((testId: string) => {
          if (testId === "message-assistant") {
            return assistantLocator as unknown as ReturnType<Page["getByTestId"]>;
          }

          expect(testId).toBe("message-user");
          return userLocator as unknown as ReturnType<Page["getByTestId"]>;
        }),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);

    const snapshot = await (chatPage as any).captureAssistantSnapshot();

    expect(snapshot).toEqual({
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
      userCount: 0,
      latestUserMessageId: null,
      latestUserMessageText: "",
    });
    expect(assistantLocator.count).toHaveBeenCalledOnce();
    expect(userLocator.count).toHaveBeenCalledOnce();
  });

  it("captures the latest assistant message payload", async () => {
    const messageContentLocator = {
      innerText: vi.fn().mockResolvedValue("  Hello world  "),
    };
    const artifactLocator = {
      count: vi.fn().mockResolvedValue(2),
    };
    const lastAssistantMessage = {
      getAttribute: vi.fn().mockResolvedValue("assistant-1"),
      getByTestId: vi
        .fn()
        .mockImplementation((testId: string) => {
          expect(testId).toBe("message-content");
          return messageContentLocator;
        }),
      locator: vi
        .fn()
        .mockImplementation((selector: string) => {
          expect(selector).toBe('[data-testid$="-artifact"]');
          return artifactLocator;
        }),
    };
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(3),
      nth: vi.fn().mockImplementation((index: number) => {
        expect(index).toBe(2);
        return lastAssistantMessage;
      }),
    };

    const userLocator = {
      count: vi.fn().mockResolvedValue(0),
    };

    const page = {
      getByTestId: vi
        .fn<Page["getByTestId"]>()
        .mockImplementation((testId: string) => {
          if (testId === "message-assistant") {
            return assistantLocator as unknown as ReturnType<Page["getByTestId"]>;
          }

          expect(testId).toBe("message-user");
          return userLocator as unknown as ReturnType<Page["getByTestId"]>;
        }),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);

    const snapshot = await (chatPage as any).captureAssistantSnapshot();

    expect(snapshot).toEqual({
      count: 3,
      latestArtifactCount: 2,
      latestMessageId: 'assistant-1',
      latestMessageText: "Hello world",
      userCount: 0,
      latestUserMessageId: null,
      latestUserMessageText: "",
    });
    expect(assistantLocator.count).toHaveBeenCalledOnce();
    expect(assistantLocator.nth).toHaveBeenCalledWith(2);
  });

  it("records a snapshot before sending a user message", async () => {
    const order: string[] = [];
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const userLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const sendButton = {
      click: vi.fn(async () => {
        order.push("send-click");
      }),
    };
    const page = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "multimodal-input") {
          return {
            click: vi.fn(),
            fill: vi.fn(),
          };
        }

        if (testId === "send-button") {
          return sendButton;
        }

        if (testId === "message-assistant") {
          order.push("assistant-snapshot");
          return assistantLocator;
        }

        if (testId === "message-user") {
          return userLocator;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baseline = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
      userCount: 0,
      latestUserMessageId: null,
      latestUserMessageText: "",
    } as const;

    const captureSpy = vi
      .spyOn(chatPage as any, "captureAssistantSnapshot")
      .mockImplementation(async () => {
        order.push("capture-call");
        return baseline;
      });
    const waitSpy = vi
      .spyOn(chatPage as any, "waitForChatApiResponse")
      .mockImplementation(async () => {
        order.push("wait");
      });

    const originalExpect = ChatPage.expect;
    const visibleSpy = vi.fn(async () => {
      order.push("send-visible");
    });
    const enabledSpy = vi.fn(async () => {
      order.push("send-enabled");
    });

    ChatPage.expect = vi
      .fn((target: unknown) => {
        if (target === sendButton) {
          return {
            toBeVisible: visibleSpy,
            toBeEnabled: enabledSpy,
          } as unknown as ReturnType<typeof ChatPage.expect>;
        }

        return {
          toBeVisible: vi.fn(),
          toBeEnabled: vi.fn(),
        } as unknown as ReturnType<typeof ChatPage.expect>;
      })
      .mockName("ChatPage.expect") as unknown as typeof ChatPage.expect;

    try {
      await chatPage.sendUserMessage("Hello");

      expect(captureSpy).toHaveBeenCalledOnce();
      expect(waitSpy).toHaveBeenCalledOnce();
      expect(visibleSpy).toHaveBeenCalledWith({ timeout: 30_000 });
      expect(enabledSpy).toHaveBeenCalledWith({ timeout: 30_000 });
      expect(order.indexOf("capture-call")).toBeGreaterThan(
        order.indexOf("send-enabled")
      );
      expect(order).toEqual([
        "send-visible",
        "send-enabled",
        "capture-call",
        "wait",
        "send-click",
      ]);
      expect((chatPage as any).pendingAssistantSnapshot).toEqual(baseline);
    } finally {
      ChatPage.expect = originalExpect;
    }
  });

  it("records a snapshot before sending a suggestion message", async () => {
    const order: string[] = [];
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const userLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const suggestionLocator = {
      click: vi.fn(async () => {
        order.push("suggestion-click");
      }),
    };
    const page = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "suggested-action-0") {
          return suggestionLocator;
        }

        if (testId === "message-assistant") {
          order.push("assistant-snapshot");
          return assistantLocator;
        }

        if (testId === "message-user") {
          return userLocator;
        }

        if (testId === "multimodal-input") {
          return {
            click: vi.fn(),
            fill: vi.fn(),
          };
        }

        if (testId === "send-button") {
          return {
            click: vi.fn(),
          };
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      waitForFunction: vi.fn(async () => {
        order.push("wait-for-user");
      }),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baseline = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
      userCount: 0,
      latestUserMessageId: null,
      latestUserMessageText: "",
    } as const;

    const captureSpy = vi
      .spyOn(chatPage as any, "captureAssistantSnapshot")
      .mockImplementation(async () => {
        order.push("capture-call");
        return baseline;
      });
    const waitSpy = vi
      .spyOn(chatPage as any, "waitForChatApiResponse")
      .mockImplementation(async () => {
        order.push("wait");
      });

    const originalExpect = ChatPage.expect;
    const visibleSpy = vi.fn(async () => {
      order.push("suggestion-visible");
    });
    const enabledSpy = vi.fn(async () => {
      order.push("suggestion-enabled");
    });

    ChatPage.expect = vi
      .fn((target: unknown) => {
        if (target === suggestionLocator) {
          return {
            toBeVisible: visibleSpy,
            toBeEnabled: enabledSpy,
          } as unknown as ReturnType<typeof ChatPage.expect>;
        }

        return {
          toBeVisible: vi.fn(),
          toBeEnabled: vi.fn(),
        } as unknown as ReturnType<typeof ChatPage.expect>;
      })
      .mockName("ChatPage.expect") as unknown as typeof ChatPage.expect;

    try {
      await chatPage.sendUserMessageFromSuggestion();

      expect(captureSpy).toHaveBeenCalledOnce();
      expect(waitSpy).toHaveBeenCalledOnce();
      expect(visibleSpy).toHaveBeenCalledWith({ timeout: 30_000 });
      expect(enabledSpy).toHaveBeenCalledWith({ timeout: 30_000 });
      expect(order.indexOf("capture-call")).toBeGreaterThan(
        order.indexOf("suggestion-enabled")
      );
      expect(order).toEqual([
        "suggestion-visible",
        "suggestion-enabled",
        "capture-call",
        "wait",
        "suggestion-click",
        "wait-for-user",
      ]);
      expect((chatPage as any).pendingAssistantSnapshot).toEqual(baseline);
    } finally {
      ChatPage.expect = originalExpect;
    }
  });

  it("records a snapshot before editing the latest user message", async () => {
    const order: string[] = [];
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(1),
    };
    const messageEditButton = { click: vi.fn(async () => order.push("edit-open")) };
    const messageEditor = {
      fill: vi.fn(async () => order.push("editor-fill")),
    };
    const messageEditorSendButton = {
      click: vi.fn(async () => order.push("editor-send")),
      waitFor: vi.fn().mockImplementation(async (options: { state: "hidden" | "detached" }) => {
        order.push(`wait-for-${options.state}`);
        if (options.state === "hidden") {
          throw new Error("hidden state unavailable");
        }
      }),
    };
    const userMessageLocator = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-content") {
          return { innerText: vi.fn().mockResolvedValue("Hello") };
        }

        if (testId === "message-attachments") {
          return {
            isVisible: vi.fn().mockResolvedValue(false),
          };
        }

        throw new Error(`Unexpected getByTestId call: ${testId}`);
      }),
    };
    const page = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-user") {
          return {
            all: vi.fn().mockResolvedValue([userMessageLocator]),
          };
        }

        if (testId === "message-assistant") {
          order.push("assistant-snapshot");
          return assistantLocator;
        }

        if (testId === "message-edit-button") {
          return messageEditButton;
        }

        if (testId === "message-editor") {
          return messageEditor;
        }

        if (testId === "message-editor-send-button") {
          return messageEditorSendButton;
        }

        if (testId === "message-attachments") {
          return {
            isVisible: vi.fn().mockResolvedValue(false),
          };
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baseline = {
      count: 1,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    } as const;

    const captureSpy = vi
      .spyOn(chatPage as any, "captureAssistantSnapshot")
      .mockImplementation(async () => {
        order.push("capture-call");
        return baseline;
      });
    const waitSpy = vi
      .spyOn(chatPage as any, "waitForChatApiResponse")
      .mockImplementation(async () => {
        order.push("wait");
      });

    const userMessage = await chatPage.getRecentUserMessage();
    await userMessage.edit("Updated message");

    expect(captureSpy).toHaveBeenCalledOnce();
    expect(waitSpy).toHaveBeenCalledOnce();
    expect(order.indexOf("capture-call")).toBeLessThan(order.indexOf("editor-send"));
    expect((chatPage as any).pendingAssistantSnapshot).toEqual(baseline);
    expect(messageEditButton.click).toHaveBeenCalledOnce();
    expect(messageEditor.fill).toHaveBeenCalledWith("Updated message");
    expect(messageEditorSendButton.click).toHaveBeenCalledOnce();
    expect(messageEditorSendButton.waitFor).toHaveBeenCalledTimes(2);
    expect(messageEditorSendButton.waitFor).toHaveBeenNthCalledWith(1, {
      state: "hidden",
    });
    expect(messageEditorSendButton.waitFor).toHaveBeenNthCalledWith(2, {
      state: "detached",
    });
  });
});

describe("ChatPage.resolveModelSelectorItem", () => {
  const reasoningModel = chatModels.find(
    (model) => model.id === "chat-model-reasoning"
  )!;

  it("returns the data-testid locator when present", async () => {
    const testIdLocator = {
      count: vi.fn().mockResolvedValue(1),
      first: vi.fn().mockReturnThis(),
    };
    const optionLocator = {
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn().mockReturnThis(),
    };
    const menuItemLocator = {
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn().mockReturnThis(),
    };
    const page = {
      getByTestId: vi.fn().mockReturnValue(testIdLocator),
      getByRole: vi
        .fn()
        .mockImplementation((role: string) =>
          role === "option" ? optionLocator : menuItemLocator
        ),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    const chatPage = new ChatPage(page);
    const resolved = await (chatPage as any).resolveModelSelectorItem({
      chatModel: reasoningModel,
      timeoutMs: 100,
    });

    expect(resolved).toBe(testIdLocator);
    expect(testIdLocator.first).toHaveBeenCalled();
    expect(optionLocator.count).not.toHaveBeenCalled();
  });

  it("falls back to the option role when the test id is absent", async () => {
    const testIdLocator = {
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn().mockReturnThis(),
    };
    const optionLocator = {
      count: vi.fn().mockResolvedValue(1),
      first: vi.fn().mockReturnThis(),
    };
    const menuItemLocator = {
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn().mockReturnThis(),
    };
    const page = {
      getByTestId: vi.fn().mockReturnValue(testIdLocator),
      getByRole: vi
        .fn()
        .mockImplementation((role: string) =>
          role === "option" ? optionLocator : menuItemLocator
        ),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    const chatPage = new ChatPage(page);
    const resolved = await (chatPage as any).resolveModelSelectorItem({
      chatModel: reasoningModel,
      timeoutMs: 100,
    });

    expect(resolved).toBe(optionLocator);
    expect(optionLocator.first).toHaveBeenCalled();
    expect(menuItemLocator.count).not.toHaveBeenCalled();
  });

  it("falls back to the menu item role when neither test id nor option exist", async () => {
    const testIdLocator = {
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn().mockReturnThis(),
    };
    const optionLocator = {
      count: vi.fn().mockResolvedValue(0),
      first: vi.fn().mockReturnThis(),
    };
    const menuItemLocator = {
      count: vi.fn().mockResolvedValue(1),
      first: vi.fn().mockReturnThis(),
    };
    const page = {
      getByTestId: vi.fn().mockReturnValue(testIdLocator),
      getByRole: vi
        .fn()
        .mockImplementation((role: string) =>
          role === "option" ? optionLocator : menuItemLocator
        ),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    const chatPage = new ChatPage(page);
    const resolved = await (chatPage as any).resolveModelSelectorItem({
      chatModel: reasoningModel,
      timeoutMs: 100,
    });

    expect(resolved).toBe(menuItemLocator);
    expect(menuItemLocator.first).toHaveBeenCalled();
  });
});
