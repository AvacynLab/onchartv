import type { BrowserContext, Locator, Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { chatModels } from "@/lib/ai/models";
import { DEFAULT_ONBOARDING_SUGGESTION } from "@/lib/constants";

import { ChatPage } from "../../pages/chat";

type MockResponseOptions = {
  url: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: string;
  method?: string;
};

const createMockRequest = ({
  url,
  method = "POST",
  response,
}: {
  url: string;
  method?: string;
  response?: () => unknown;
}) => ({
  url: () => url,
  method: () => method,
  response:
    response ?? vi.fn().mockResolvedValue(null),
});

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

const TOAST_SELECTOR = '[data-testid="toast"], #automation-toast-bridge';

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
    const createListenerRegistry = () => ({
      request: new Set<(...args: any[]) => unknown>(),
      response: new Set<(...args: any[]) => unknown>(),
      requestfailed: new Set<(...args: any[]) => unknown>(),
      signal: new Set<(...args: any[]) => unknown>(),
      composer: new Set<(...args: any[]) => unknown>(),
    });

    const createWaiterRegistry = () => ({
      request: new Set<{
        predicate: (payload: unknown) => boolean;
        resolve: (payload: unknown) => void;
      }>(),
      response: new Set<{
        predicate: (payload: unknown) => boolean;
        resolve: (payload: unknown) => void;
      }>(),
      requestfailed: new Set<{
        predicate: (payload: unknown) => boolean;
        resolve: (payload: unknown) => void;
      }>(),
      signal: new Set<{
        predicate: (payload: unknown) => boolean;
        resolve: (payload: unknown) => void;
      }>(),
      composer: new Set<{
        predicate: (payload: unknown) => boolean;
        resolve: (payload: unknown) => void;
      }>(),
    });

    const pageListeners = createListenerRegistry();
    const contextListeners = createListenerRegistry();
    const pageWaiters = createWaiterRegistry();
    const contextWaiters = createWaiterRegistry();
    /**
     * The chat composer emits Playwright-facing “signals” in the browser
     * context. The harness mirrors that counter so unit tests can simulate the
     * race between network responses and UI instrumentation without reaching
     * for real pages.
     */
    let chatSignalCount = 0;

    const registerWaiter = (
      registry: ReturnType<typeof createWaiterRegistry>,
      event: keyof ReturnType<typeof createWaiterRegistry>,
      predicate: (payload: unknown) => boolean
    ) =>
      new Promise<unknown>((resolve) => {
        registry[event].add({ predicate, resolve });
      });

    const emitFrom = async (
      listeners: ReturnType<typeof createListenerRegistry>,
      waiters: ReturnType<typeof createWaiterRegistry>,
      event: keyof ReturnType<typeof createListenerRegistry>,
      payload: unknown
    ) => {
      for (const waiter of Array.from(waiters[event])) {
        if (waiter.predicate(payload)) {
          waiters[event].delete(waiter);
          waiter.resolve(payload);
        }
      }

      for (const handler of Array.from(listeners[event] ?? [])) {
        await handler(payload);
      }
    };

    const createEmitter = (
      registry: ReturnType<typeof createListenerRegistry>
    ) => ({
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        registry[event as keyof typeof registry]?.add(handler);
      }),
      off: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        registry[event as keyof typeof registry]?.delete(handler);
      }),
    });

    const browserContext = {
      ...createEmitter(contextListeners),
      waitForEvent: vi.fn(
        (
          event: string,
          options?: { predicate?: (payload: unknown) => boolean }
        ) => {
          if (
            event === "request" ||
            event === "response" ||
            event === "requestfailed"
          ) {
            return registerWaiter(
              contextWaiters,
              event,
              options?.predicate ?? (() => true)
            ) as Promise<any>;
          }

          throw new Error(`Unexpected browser context event: ${event}`);
        }
      ),
    } satisfies Partial<BrowserContext>;

    const stopButtonLocator = {
      isVisible: vi.fn().mockResolvedValue(false),
    };
    const sendButtonLocator = {
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
    };

    const assistantContentLocator = {
      innerText: vi.fn().mockResolvedValue(""),
    };
    const assistantArtifactsLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const assistantMessageLocator = {
      getAttribute: vi.fn().mockResolvedValue(null),
      getByTestId: vi
        .fn((testId: string) => {
          if (testId === "message-content") {
            return assistantContentLocator as unknown as ReturnType<Page["getByTestId"]>;
          }

          throw new Error(`Unexpected assistant test id access: ${testId}`);
        })
        .mockName("assistantMessageLocator.getByTestId"),
      locator: vi
        .fn(() =>
          assistantArtifactsLocator as unknown as ReturnType<Page["locator"]>
        )
        .mockName("assistantMessageLocator.locator"),
    };
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(0),
      nth: vi
        .fn(() => assistantMessageLocator as unknown as ReturnType<Page["getByTestId"]>)
        .mockName("assistantLocator.nth"),
    };
    const spinnerLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const userLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const composerLocator = {
      inputValue: vi.fn().mockResolvedValue(""),
      press: vi.fn().mockResolvedValue(undefined),
    };
    const suggestedActionsLocator = {
      isVisible: vi.fn().mockResolvedValue(true),
    };
    const toastLocator = {
      first: vi
        .fn(() => toastLocator as unknown as ReturnType<Locator["first"]>)
        .mockName("toastLocator.first"),
      last: vi
        .fn(() => toastLocator as unknown as ReturnType<Locator["last"]>)
        .mockName("toastLocator.last"),
      waitFor: vi
        .fn(() => new Promise<never>(() => {}))
        .mockName("toastLocator.waitFor"),
      innerText: vi.fn().mockResolvedValue(""),
    } satisfies Partial<Locator>;

    const page = {
      ...createEmitter(pageListeners),
      context: vi.fn(() => browserContext as BrowserContext),
      waitForRequest: vi.fn(
        (
          predicate: (payload: unknown) => boolean,
          _options?: { timeout?: number }
        ) => registerWaiter(pageWaiters, "request", predicate)
      ),
      waitForResponse: vi.fn(
        (
          predicate: (payload: unknown) => boolean,
          _options?: { timeout?: number }
        ) => registerWaiter(pageWaiters, "response", predicate)
      ),
      waitForEvent: vi.fn(
        (
          event: string,
          options?: { predicate?: (payload: unknown) => boolean }
        ) => {
          if (event !== "requestfailed" && event !== "response") {
            throw new Error(`Unexpected page event: ${event}`);
          }

          return registerWaiter(
            pageWaiters,
            event,
            options?.predicate ?? (() => true)
          );
        }
      ),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid$="-artifact"]') {
          return assistantArtifactsLocator as unknown as ReturnType<Page["locator"]>;
        }

        if (selector === TOAST_SELECTOR) {
          return toastLocator as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      getByTestId: vi.fn((testId: string) => {
        if (testId === "stop-button") {
          return stopButtonLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return sendButtonLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant") {
          return assistantLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant-loading") {
          return spinnerLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return userLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return composerLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "suggested-actions") {
          return suggestedActionsLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id access: ${testId}`);
      }),
      waitForFunction: vi.fn(
        (
          _predicate: (...args: unknown[]) => unknown,
          baseline: unknown,
          _options?: { timeout?: number }
        ) => {
          if (typeof baseline === "number") {
            const numericBaseline = baseline;

            if (chatSignalCount > numericBaseline) {
              return Promise.resolve(undefined);
            }

            /**
             * The real implementation waits for `window.__PLAYWRIGHT_CHAT_SIGNALS__`
             * to gain new entries. Replicate that by registering a waiter that
             * resolves once the in-memory counter surpasses the captured
             * baseline.
             */
            return registerWaiter(
              pageWaiters,
              "signal",
              (payload: unknown) =>
                typeof payload === "object" &&
                payload !== null &&
                "count" in (payload as { count?: unknown }) &&
                typeof (payload as { count?: unknown }).count === "number" &&
                ((payload as { count: number }).count > numericBaseline)
            ).then(() => undefined);
          }

          if (typeof baseline === "string") {
            return registerWaiter(
              pageWaiters,
              "composer",
              (payload: unknown) =>
                typeof payload === "string" &&
                payload.trim().length === 0 &&
                payload !== baseline
            ).then(() => undefined);
          }

          return Promise.resolve(undefined);
        }
      ),
      waitForTimeout: vi
        .fn(() => Promise.resolve())
        .mockName("page.waitForTimeout"),
      evaluate: vi
        .fn(() => Promise.resolve(chatSignalCount))
        .mockName("page.evaluate"),
    } satisfies Partial<Page>;

    return {
      page: page as Page,
      emitRequest: (payload: any) =>
        emitFrom(pageListeners, pageWaiters, "request", payload),
      emitContextRequest: (payload: any) =>
        emitFrom(contextListeners, contextWaiters, "request", payload),
      emitResponse: (payload: any) =>
        emitFrom(pageListeners, pageWaiters, "response", payload),
      emitContextResponse: (payload: any) =>
        emitFrom(contextListeners, contextWaiters, "response", payload),
      emitFailure: (payload: any) =>
        emitFrom(pageListeners, pageWaiters, "requestfailed", payload),
      emitContextFailure: (payload: any) =>
        emitFrom(contextListeners, contextWaiters, "requestfailed", payload),
      emitSignal: (increment = 1) => {
        /**
         * Increment the synthetic signal buffer so the `waitForFunction`
         * promise resolves exactly as it would when the browser pushes a new
         * entry into `window.__PLAYWRIGHT_CHAT_SIGNALS__`.
         */
        chatSignalCount += increment;
        return emitFrom(pageListeners, pageWaiters, "signal", {
          count: chatSignalCount,
        });
      },
      emitComposerClear: (nextValue = "") =>
        emitFrom(pageListeners, pageWaiters, "composer", nextValue),
      setSignalCount: (nextCount: number) => {
        chatSignalCount = nextCount;
      },
      listeners: { page: pageListeners, context: contextListeners },
      sendButtonLocator,
      stopButtonLocator,
      suggestedActionsLocator,
      toastLocator,
    };
  };

  const stubFallback = (chatPage: ChatPage) =>
    vi
      .spyOn(chatPage as unknown as { waitForUiStreamingFallback: () => Promise<void> }, "waitForUiStreamingFallback")
      .mockResolvedValue(undefined);

  const seedPendingSnapshot = (chatPage: ChatPage) => {
    (chatPage as any).pendingAssistantSnapshot = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    };
    (chatPage as any).pendingUserMessageCount = 0;
    (chatPage as any).pendingStopButtonWasVisible = false;
    (chatPage as any).pendingSendButtonWasVisible = true;
    (chatPage as any).pendingSendButtonWasEnabled = true;
    (chatPage as any).pendingChatSignalCount = 0;
    (chatPage as any).pendingComposerValue = "";
    (chatPage as any).pendingComposerNeedsClear = false;
    (chatPage as any).pendingSuggestedActionsWereVisible = false;
  };

  it("resolves once POST /api/chat responds, including query parameters", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);
      stubFallback(chatPage);
      seedPendingSnapshot(chatPage);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

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

  it("handles chat requests that resolve without a response payload", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);

      stubFallback(chatPage);
      seedPendingSnapshot(chatPage);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitRequest({
        method: () => "POST",
        url: () => "http://localhost:3000/api/chat",
        response: vi.fn().mockResolvedValue(null),
      });

      await expect(waitPromise).resolves.toBeUndefined();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("ignores chat API requests targeting non-local hosts", () => {
    const harness = createEventHarness();
    const chatPage = new ChatPage(harness.page);

    // External hosts (for example OpenAI endpoints) should be ignored to keep
    // hermetic Playwright runs offline.
    const result = (chatPage as any).matchesChatApiRequest({
      url: () => "https://api.example.com/api/chat",
      method: () => "POST",
    });

    expect(result).toBe(false);
  });

  it("resolves as soon as a Playwright chat signal is emitted", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);
      stubFallback(chatPage);
      seedPendingSnapshot(chatPage);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitSignal();

      await expect(waitPromise).resolves.toBeUndefined();
      expect(harness.page.waitForFunction).toHaveBeenCalledWith(
        expect.any(Function),
        0,
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("resolves when the composer clears after seeding a pending value", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);
      stubFallback(chatPage);
      seedPendingSnapshot(chatPage);

      (chatPage as any).pendingComposerValue = "Bonjour";
      (chatPage as any).pendingComposerNeedsClear = true;

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitComposerClear("");

      await expect(waitPromise).resolves.toBeUndefined();
      expect((chatPage as any).pendingComposerNeedsClear).toBe(false);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("observes chat transports emitted directly by the browser context", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);
      stubFallback(chatPage);
      seedPendingSnapshot(chatPage);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitContextResponse(
        createMockResponse({
          url: "http://localhost:3000/api/chat",
          ok: true,
        })
      );

      await expect(waitPromise).resolves.toBeUndefined();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("resolves after observing a matching chat request even when the response is still streaming", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);
      stubFallback(chatPage);
      seedPendingSnapshot(chatPage);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitRequest(
        createMockRequest({
          url: "http://localhost:3000/api/chat?chatId=slow-stream",
          response: () => new Promise(() => {}),
        })
      );

      await vi.advanceTimersByTimeAsync(1_000);

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
      stubFallback(chatPage);
      seedPendingSnapshot(chatPage);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitResponse(
        createMockResponse({
          url: "http://localhost:3000/api/chat/fake-id/stream",
          ok: true,
          method: "GET",
        })
      );

      await expect(waitPromise).resolves.toBeUndefined();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("accepts nested chat endpoints such as message edits", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);
      stubFallback(chatPage);
      seedPendingSnapshot(chatPage);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitResponse(
        createMockResponse({
          url: "http://localhost:3000/api/chat/abc/messages/def",
          ok: true,
          method: "PATCH",
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
      stubFallback(chatPage);
      seedPendingSnapshot(chatPage);

      harness.toastLocator.waitFor.mockResolvedValue(undefined);
      harness.toastLocator.innerText.mockResolvedValue(
        "A regular account is required to use this feature."
      );

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitResponse(
        createMockResponse({
          url: "http://localhost:3000/api/chat",
          ok: false,
          status: 403,
          statusText: "Forbidden",
          body: JSON.stringify({
            error: {
              code: "forbidden:chat",
              message: "Regular session required",
            },
          }),
        })
      );

      await expect(waitPromise).rejects.toThrow(
        'Chat API rejected the request (403 Forbidden, code forbidden:chat) after surfacing a toast: "A regular account is required to use this feature."'
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

  it("throws when a streaming GET transport fails before responding", async () => {
    vi.useFakeTimers();
    try {
      const harness = createEventHarness();
      const chatPage = new ChatPage(harness.page);

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await harness.emitFailure({
        method: () => "GET",
        url: () => "http://localhost:3000/api/chat/example-id/stream",
        failure: () => ({ errorText: "net::ERR_STREAM_CLOSED" }),
      });

      await expect(waitPromise).rejects.toThrow(
        "Chat API request failed before receiving a response – net::ERR_STREAM_CLOSED"
      );
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("falls back to UI polling when the network error indicates an offline transport", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const toastWaitFor = vi.fn().mockImplementation(
        () => new Promise(() => {})
      );
      const toastInnerText = vi.fn().mockResolvedValue("");
      const assistantCount = vi.fn().mockResolvedValue(0);
      const spinnerCount = vi
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValue(0);
      const toastLocatorHandle = {
        waitFor: toastWaitFor,
        innerText: toastInnerText,
      } as const;

      const harness = createEventHarness();
      (harness.page.getByTestId as ReturnType<typeof vi.fn>).mockImplementation(
        (testId: string) => {
          if (testId === "toast") {
            return toastLocatorHandle as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "multimodal-input") {
            return {
              inputValue: vi.fn().mockResolvedValue(""),
              press: vi.fn().mockResolvedValue(undefined),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant") {
            return {
              count: assistantCount,
              nth: vi.fn(),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "message-assistant-loading") {
            return {
              count: spinnerCount,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "stop-button") {
            return {
              isVisible: vi.fn().mockResolvedValue(false),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

        if (testId === "send-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: vi.fn().mockResolvedValue(0),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id ${testId}`);
      }
    );
      (harness.page.locator as ReturnType<typeof vi.fn>).mockImplementation(
        (selector: string) => {
          if (selector === '[data-testid="toast"], #automation-toast-bridge') {
            return {
              first: () => toastLocatorHandle,
            } as unknown as ReturnType<Page["locator"]>;
          }

          throw new Error(`Unexpected locator access: ${selector}`);
        }
      );

      const chatPage = new ChatPage(harness.page);
      seedPendingSnapshot(chatPage);

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
        timeout: 45_000,
      });
      expect(assistantCount).toHaveBeenCalled();
      expect(spinnerCount).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("falls back to UI guards when no network events fire", async () => {
    vi.useFakeTimers();
    try {
      const toastWaitFor = vi.fn().mockImplementation(
        () => new Promise(() => {})
      );
      const toastInnerText = vi.fn().mockResolvedValue("");
      const assistantCount = vi.fn().mockResolvedValue(0);
      let spinnerCalls = 0;
      const spinnerCount = vi
        .fn()
        .mockImplementation(async () => (spinnerCalls++ === 0 ? 1 : 0));
      const toastLocatorHandle = {
        waitFor: toastWaitFor,
        innerText: toastInnerText,
      } as const;

      const harness = createEventHarness();
      (harness.page.getByTestId as ReturnType<typeof vi.fn>).mockImplementation(
        (testId: string) => {
          if (testId === "toast") {
            return toastLocatorHandle as unknown as ReturnType<Page["getByTestId"]>;
          }

        if (testId === "message-assistant") {
          return {
            count: assistantCount,
            nth: vi.fn(),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant-loading") {
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(false),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: vi.fn().mockResolvedValue(0),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id ${testId}`);
      }
    );
      (harness.page.locator as ReturnType<typeof vi.fn>).mockImplementation(
        (selector: string) => {
          if (selector === '[data-testid="toast"], #automation-toast-bridge') {
            return {
              first: () => toastLocatorHandle,
            } as unknown as ReturnType<Page["locator"]>;
          }

          throw new Error(`Unexpected locator access: ${selector}`);
        }
      );

      const chatPage = new ChatPage(harness.page);
      (chatPage as any).pendingAssistantSnapshot = {
        count: 0,
        latestArtifactCount: 0,
        latestMessageId: null,
        latestMessageText: "",
      };
      (chatPage as any).pendingSendButtonWasVisible = true;
      (chatPage as any).pendingStopButtonWasVisible = false;

      const waitPromise = (chatPage as any).waitForChatApiResponse();

      await vi.advanceTimersByTimeAsync(15_000);

      await expect(waitPromise).resolves.toBeUndefined();
      expect(toastWaitFor).toHaveBeenCalledWith({
        state: "visible",
        timeout: 45_000,
      });
      expect(spinnerCount).toHaveBeenCalled();
      expect(assistantCount).toHaveBeenCalled();
      expect(
        (harness.page.getByTestId as ReturnType<typeof vi.fn>).mock.calls
          .flat()
      ).toContain("stop-button");
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("throws a descriptive timeout error when the UI never indicates streaming", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi.fn().mockResolvedValue(1);
    const latestAssistant = {
      getAttribute: vi.fn().mockImplementation(async (attribute: string) => {
        if (attribute === "data-message-id") {
          return "assistant-1";
        }

        if (attribute === "data-message-status") {
          return "completed";
        }

        return null;
      }),
      getByTestId: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue("Thinking..."),
      }),
      locator: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue(0),
      }),
    };
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const toastLocatorHandle = {
      waitFor: toastWaitFor,
      innerText: toastInnerText,
    } as const;

    const harness = createEventHarness();
    (harness.page.getByTestId as ReturnType<typeof vi.fn>).mockImplementation(
      (testId: string) => {
        if (testId === "toast") {
          return toastLocatorHandle as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant") {
          return {
            count: assistantCount,
            nth: vi.fn().mockReturnValue(latestAssistant),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant-loading") {
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(false),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: vi.fn().mockResolvedValue(0),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id ${testId}`);
      }
    );
    (harness.page.locator as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => toastLocatorHandle,
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }
    );

    const chatPage = new ChatPage(harness.page);
    const pollSpy = vi
      .spyOn(chatPage as any, "pollForStreamingChange")
      .mockRejectedValue(new Error("Timed out waiting for chat UI to start streaming"));

    const baselineSnapshot = {
      count: 1,
      latestArtifactCount: 0,
      latestMessageId: "assistant-1",
      latestMessageText: "Thinking...",
    } as const;

    await expect(
      (chatPage as any).waitForUiStreamingFallback({
        baseline: baselineSnapshot,
        baselineUserMessageCount: 0,
        baselineStopButtonVisible: false,
        baselineSendButtonVisible: true,
        baselineSendButtonEnabled: true,
        baselineChatSignalCount: 0,
        baselineComposerValue: "",
        baselineSuggestedActionsVisible: false,
        timeoutMs: 45_000,
      })
    ).rejects.toThrow("Timed out waiting for chat UI to start streaming");

    expect(pollSpy).toHaveBeenCalledWith({
      baseline: baselineSnapshot,
      baselineUserMessageCount: 0,
      baselineStopButtonVisible: false,
      baselineSendButtonVisible: true,
      baselineSendButtonEnabled: true,
      baselineChatSignalCount: 0,
      baselineComposerValue: "",
      baselineSuggestedActionsVisible: false,
      timeoutMs: 45_000,
    });
    expect(toastWaitFor).toHaveBeenCalledWith({
      state: "visible",
      timeout: 45_000,
    });
    expect(assistantCount).not.toHaveBeenCalled();
    expect(spinnerCount).not.toHaveBeenCalled();
  });

  it("treats a fresh stop button toggle as evidence of streaming", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi.fn().mockResolvedValue(0);
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const stopVisible = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
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
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: stopVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: vi.fn().mockResolvedValue(0),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
      evaluate: vi
        .fn(() => Promise.resolve(0))
        .mockName("page.evaluate"),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baselineSnapshot = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    } as const;

  await (chatPage as any).waitForUiStreamingFallback({
    baseline: baselineSnapshot,
    baselineUserMessageCount: 0,
    baselineStopButtonVisible: false,
    baselineSendButtonVisible: true,
    baselineSendButtonEnabled: true,
    baselineChatSignalCount: 0,
    baselineComposerValue: "",
    baselineSuggestedActionsVisible: false,
    timeoutMs: 5_000,
  });

    expect(stopVisible).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalled();
  });

  it("recognises a hidden send button as a fresh streaming signal", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi.fn().mockResolvedValue(0);
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const sendVisible = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
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
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(false),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: sendVisible,
            isEnabled: vi.fn().mockResolvedValue(true),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: vi.fn().mockResolvedValue(0),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
      evaluate: vi
        .fn(() => Promise.resolve(0))
        .mockName("page.evaluate"),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baselineSnapshot = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    } as const;

  await (chatPage as any).waitForUiStreamingFallback({
    baseline: baselineSnapshot,
    baselineUserMessageCount: 0,
    baselineStopButtonVisible: false,
    baselineSendButtonVisible: true,
    baselineSendButtonEnabled: true,
    baselineChatSignalCount: 0,
    baselineComposerValue: "",
    baselineSuggestedActionsVisible: false,
    timeoutMs: 5_000,
  });

    expect(sendVisible).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalled();
  });

  it("considers an assistant removal as a streaming hint", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(0);
    const latestAssistantGetAttribute = vi.fn().mockImplementation(
      async (attribute: string) => {
        if (attribute === "data-message-id") {
          return "assistant-1";
        }

        if (attribute === "data-message-status") {
          return "completed";
        }

        return null;
      }
    );
    const latestAssistantText = vi.fn().mockResolvedValue("Original reply");
    const latestAssistantArtifactCount = vi.fn().mockResolvedValue(0);
    const latestAssistantLocator = {
      getAttribute: latestAssistantGetAttribute,
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-content") {
          return { innerText: latestAssistantText };
        }
        throw new Error(`Unexpected assistant test id: ${testId}`);
      }),
      locator: vi.fn(() => ({ count: latestAssistantArtifactCount })),
    };
    const assistantLocator = {
      count: assistantCount,
      nth: vi.fn(() => latestAssistantLocator),
    };
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const stopVisible = vi.fn().mockResolvedValue(false);
    const sendVisible = vi.fn().mockResolvedValue(true);
    const sendEnabled = vi.fn().mockResolvedValue(true);
    const userCount = vi.fn().mockResolvedValue(1);
    const evaluateSignals = vi.fn().mockResolvedValue(0);
    const composerValue = vi.fn().mockResolvedValue("Edited message contents");
    const suggestedActionsVisible = vi.fn().mockResolvedValue(false);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "toast") {
          return {
            waitFor: toastWaitFor,
            innerText: toastInnerText,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant") {
          return assistantLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant-loading") {
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: stopVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: sendVisible,
            isEnabled: sendEnabled,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: userCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: composerValue,
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "suggested-actions") {
          return {
            isVisible: suggestedActionsVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
      evaluate: evaluateSignals as unknown as Page["evaluate"],
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baselineSnapshot = {
      count: 1,
      latestArtifactCount: 0,
      latestMessageId: "assistant-1",
      latestMessageText: "Original reply",
    } as const;

    await (chatPage as any).waitForUiStreamingFallback({
      baseline: baselineSnapshot,
      baselineUserMessageCount: 1,
      baselineStopButtonVisible: false,
      baselineSendButtonVisible: true,
      baselineSendButtonEnabled: true,
      baselineChatSignalCount: 0,
      baselineComposerValue: "Edited message contents",
      baselineSuggestedActionsVisible: false,
      timeoutMs: 5_000,
    });

    expect(assistantCount).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalled();
  });

  it("reconnait l'état streaming exposé sur la bulle assistant", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi.fn().mockResolvedValue(1);
    const latestAssistantGetAttribute = vi.fn().mockImplementation(
      async (attribute: string) => {
        if (attribute === "data-message-id") {
          return "assistant-1";
        }

        if (attribute === "data-message-status") {
          return "streaming";
        }

        return null;
      }
    );
    const latestAssistantText = vi.fn().mockResolvedValue("Original reply");
    const latestAssistantArtifactCount = vi.fn().mockResolvedValue(0);
    const latestAssistantLocator = {
      getAttribute: latestAssistantGetAttribute,
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-content") {
          return { innerText: latestAssistantText };
        }
        throw new Error(`Unexpected assistant test id: ${testId}`);
      }),
      locator: vi.fn(() => ({ count: latestAssistantArtifactCount })),
    };
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const stopVisible = vi.fn().mockResolvedValue(false);
    const sendVisible = vi.fn().mockResolvedValue(true);
    const sendEnabled = vi.fn().mockResolvedValue(true);
    const userCount = vi.fn().mockResolvedValue(1);
    const evaluateSignals = vi.fn().mockResolvedValue(0);
    const composerValue = vi.fn().mockResolvedValue("Edited message contents");
    const suggestedActionsVisible = vi.fn().mockResolvedValue(false);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "toast") {
          return {
            waitFor: toastWaitFor,
            innerText: toastInnerText,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant") {
          return {
            count: assistantCount,
            nth: vi.fn().mockReturnValue(latestAssistantLocator),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant-loading") {
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: stopVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: sendVisible,
            isEnabled: sendEnabled,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: userCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: composerValue,
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "suggested-actions") {
          return {
            isVisible: suggestedActionsVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
      evaluate: evaluateSignals as unknown as Page["evaluate"],
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baselineSnapshot = {
      count: 1,
      latestArtifactCount: 0,
      latestMessageId: "assistant-1",
      latestMessageText: "Original reply",
    } as const;

    await (chatPage as any).waitForUiStreamingFallback({
      baseline: baselineSnapshot,
      baselineUserMessageCount: 1,
      baselineStopButtonVisible: false,
      baselineSendButtonVisible: true,
      baselineSendButtonEnabled: true,
      baselineChatSignalCount: 0,
      baselineComposerValue: "Edited message contents",
      baselineSuggestedActionsVisible: false,
      timeoutMs: 5_000,
    });

    expect(assistantCount).toHaveBeenCalled();
    expect(waitForTimeout).not.toHaveBeenCalled();
  });

  it("treats a disabled send button as evidence of streaming", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi.fn().mockResolvedValue(0);
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const sendVisible = vi.fn().mockResolvedValue(true);
    const sendEnabled = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
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
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(false),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: sendVisible,
            isEnabled: sendEnabled,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: vi.fn().mockResolvedValue(0),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
      evaluate: vi
        .fn(() => Promise.resolve(0))
        .mockName("page.evaluate"),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baselineSnapshot = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    } as const;

  await (chatPage as any).waitForUiStreamingFallback({
    baseline: baselineSnapshot,
    baselineUserMessageCount: 0,
    baselineStopButtonVisible: false,
    baselineSendButtonVisible: true,
    baselineSendButtonEnabled: true,
    baselineChatSignalCount: 0,
    baselineComposerValue: "",
    baselineSuggestedActionsVisible: false,
    timeoutMs: 5_000,
  });

    expect(sendVisible).toHaveBeenCalledTimes(2);
    expect(sendEnabled).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalled();
  });

  it("reconnaît le retour d'un message assistant recréé après une édition", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1);
    const latestAssistantGetAttribute = vi.fn().mockImplementation(
      async (attribute: string) => {
        if (attribute === "data-message-id") {
          return "assistant-new";
        }

        if (attribute === "data-message-status") {
          return "completed";
        }

        return null;
      }
    );
    const latestAssistantText = vi
      .fn()
      .mockResolvedValue("Updated assistant reply");
    const latestAssistantArtifactCount = vi.fn().mockResolvedValue(0);
    const latestAssistantLocator = {
      getAttribute: latestAssistantGetAttribute,
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-content") {
          return { innerText: latestAssistantText };
        }
        throw new Error(`Unexpected assistant test id: ${testId}`);
      }),
      locator: vi.fn(() => ({ count: latestAssistantArtifactCount })),
    };
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const stopVisible = vi.fn().mockResolvedValue(false);
    const sendVisible = vi.fn().mockResolvedValue(true);
    const sendEnabled = vi.fn().mockResolvedValue(true);
    const userCount = vi.fn().mockResolvedValue(1);
    const evaluateSignals = vi.fn().mockResolvedValue(0);
    const composerValue = vi
      .fn()
      .mockResolvedValue("Edited message contents");
    const suggestedActionsVisible = vi.fn().mockResolvedValue(false);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "toast") {
          return {
            waitFor: toastWaitFor,
            innerText: toastInnerText,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant") {
          return {
            count: assistantCount,
            nth: vi.fn().mockReturnValue(latestAssistantLocator),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-assistant-loading") {
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: stopVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: sendVisible,
            isEnabled: sendEnabled,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: userCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: composerValue,
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "suggested-actions") {
          return {
            isVisible: suggestedActionsVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
      evaluate: evaluateSignals as unknown as Page["evaluate"],
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baselineSnapshot = {
      count: 1,
      latestArtifactCount: 0,
      latestMessageId: "assistant-original",
      latestMessageText: "Initial reply",
    } as const;

    await expect(
      (chatPage as any).waitForUiStreamingFallback({
        baseline: baselineSnapshot,
        baselineUserMessageCount: 1,
        baselineStopButtonVisible: false,
        baselineSendButtonVisible: true,
        baselineSendButtonEnabled: true,
        baselineChatSignalCount: 0,
        baselineComposerValue: "Edited message contents",
        baselineSuggestedActionsVisible: false,
        timeoutMs: 5_000,
      })
    ).resolves.toBeUndefined();

    expect(assistantCount).toHaveBeenCalledTimes(3);
    expect(latestAssistantGetAttribute).toHaveBeenCalled();
    expect(latestAssistantText).toHaveBeenCalled();
    expect(waitForTimeout).toHaveBeenCalled();
  });

  it("treats a cleared composer as evidence of streaming", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi.fn().mockResolvedValue(0);
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const stopVisible = vi.fn().mockResolvedValue(false);
    const sendVisible = vi.fn().mockResolvedValue(true);
    const sendEnabled = vi.fn().mockResolvedValue(true);
    const userCount = vi.fn().mockResolvedValue(0);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const composerInputValue = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("")
      .mockResolvedValue("");

    const page = {
      getByTestId: vi.fn((testId: string) => {
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
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: stopVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: sendVisible,
            isEnabled: sendEnabled,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: userCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: composerInputValue,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
      evaluate: vi
        .fn(() => Promise.resolve(0))
        .mockName("page.evaluate"),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baselineSnapshot = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    } as const;

    await expect(
      (chatPage as any).pollForStreamingChange({
        baseline: baselineSnapshot,
        baselineUserMessageCount: 0,
        baselineStopButtonVisible: false,
        baselineSendButtonVisible: true,
        baselineSendButtonEnabled: true,
        baselineChatSignalCount: 0,
        baselineComposerValue: "Run the quarterly planning session",
        baselineSuggestedActionsVisible: false,
        timeoutMs: 5_000,
      })
    ).resolves.toBeUndefined();

    expect(composerInputValue).toHaveBeenCalled();
    expect(waitForTimeout).not.toHaveBeenCalled();
  });

  it("waits until the suggestion prefill appears before treating composer clearing as progress", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi.fn().mockResolvedValue(0);
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const stopVisible = vi.fn().mockResolvedValue(false);
    const sendVisible = vi.fn().mockResolvedValue(true);
    const sendEnabled = vi.fn().mockResolvedValue(true);
    const userCount = vi.fn().mockResolvedValue(0);
    const suggestedActionsVisible = vi.fn().mockResolvedValue(true);
    const composerValues = [
      "",
      "Run the quarterly planning session",
      "",
    ];
    const composerInputValue = vi
      .fn<() => Promise<string>>()
      .mockImplementation(() =>
        Promise.resolve(
          composerValues.length > 0 ? composerValues.shift() ?? "" : ""
        )
      );
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
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
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: stopVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: sendVisible,
            isEnabled: sendEnabled,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: userCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "suggested-actions") {
          return {
            isVisible: suggestedActionsVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: composerInputValue,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
      evaluate: vi.fn(() => Promise.resolve(0)),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    (chatPage as any).pendingComposerPrefill =
      "Run the quarterly planning session";

    const baselineSnapshot = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    } as const;

    await expect(
      (chatPage as any).pollForStreamingChange({
        baseline: baselineSnapshot,
        baselineUserMessageCount: 0,
        baselineStopButtonVisible: false,
        baselineSendButtonVisible: true,
        baselineSendButtonEnabled: true,
        baselineChatSignalCount: 0,
        baselineComposerValue: "Run the quarterly planning session",
        baselineSuggestedActionsVisible: true,
        timeoutMs: 5_000,
      })
    ).resolves.toBeUndefined();

    expect(waitForTimeout).toHaveBeenCalledWith(50);
    expect(composerInputValue).toHaveBeenCalledTimes(3);
  });

  it("treats hidden suggested actions as evidence of streaming", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi.fn().mockResolvedValue(0);
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const stopVisible = vi.fn().mockResolvedValue(false);
    const sendVisible = vi.fn().mockResolvedValue(true);
    const sendEnabled = vi.fn().mockResolvedValue(true);
    const userCount = vi.fn().mockResolvedValue(0);
    const suggestedActionsVisible = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
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
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: stopVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: sendVisible,
            isEnabled: sendEnabled,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: userCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "suggested-actions") {
          return {
            isVisible: suggestedActionsVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
      evaluate: vi
        .fn(() => Promise.resolve(0))
        .mockName("page.evaluate"),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baselineSnapshot = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    } as const;

    await expect(
      (chatPage as any).pollForStreamingChange({
        baseline: baselineSnapshot,
        baselineUserMessageCount: 0,
        baselineStopButtonVisible: false,
        baselineSendButtonVisible: true,
        baselineSendButtonEnabled: true,
        baselineChatSignalCount: 0,
        baselineComposerValue: "",
        baselineSuggestedActionsVisible: true,
        timeoutMs: 5_000,
      })
    ).resolves.toBeUndefined();

    expect(suggestedActionsVisible).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalledTimes(1);
  });

  it("treats a new user message as evidence of streaming when other guards stay idle", async () => {
    const toastWaitFor = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );
    const toastInnerText = vi.fn().mockResolvedValue("");
    const assistantCount = vi.fn().mockResolvedValue(0);
    const spinnerCount = vi.fn().mockResolvedValue(0);
    const stopVisible = vi.fn().mockResolvedValue(false);
    const sendVisible = vi.fn().mockResolvedValue(true);
    const sendEnabled = vi.fn().mockResolvedValue(true);
    const userCount = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
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
          return {
            count: spinnerCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return {
            isVisible: stopVisible,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return {
            isVisible: sendVisible,
            isEnabled: sendEnabled,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return {
            count: userCount,
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => ({
              waitFor: toastWaitFor,
              innerText: toastInnerText,
            }),
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout: waitForTimeout as unknown as Page["waitForTimeout"],
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baselineSnapshot = {
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    } as const;

  await (chatPage as any).waitForUiStreamingFallback({
    baseline: baselineSnapshot,
    baselineUserMessageCount: 0,
    baselineStopButtonVisible: false,
    baselineSendButtonVisible: true,
    baselineSendButtonEnabled: true,
    baselineChatSignalCount: 0,
    baselineComposerValue: "",
    baselineSuggestedActionsVisible: false,
    timeoutMs: 5_000,
  });

    expect(userCount).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalled();
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
    const toastLocatorHandle = {
      waitFor: toastWaitFor,
      innerText: vi.fn().mockResolvedValue("Upvoted Response!"),
    } as const;

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
          return toastLocatorHandle as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => toastLocatorHandle,
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout,
      evaluate: vi
        .fn(() => Promise.resolve(0))
        .mockName("page.evaluate"),
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
    const toastLocatorHandle = {
      waitFor: toastWaitFor,
      innerText: vi.fn().mockResolvedValue(""),
    } as const;

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
          return toastLocatorHandle as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }
        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => toastLocatorHandle,
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout,
      evaluate: vi
        .fn(() => Promise.resolve(0))
        .mockName("page.evaluate"),
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
    const toastLocatorHandle = {
      waitFor: toastWaitFor,
      innerText: vi.fn().mockResolvedValue(""),
    } as const;

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
          return toastLocatorHandle as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          } as unknown as ReturnType<Page["getByTestId"]>;
        }
        throw new Error(`Unexpected test id: ${testId}`);
      }),
      locator: vi.fn((selector: string) => {
        if (selector === '[data-testid="toast"], #automation-toast-bridge') {
          return {
            first: () => toastLocatorHandle,
          } as unknown as ReturnType<Page["locator"]>;
        }

        throw new Error(`Unexpected locator access: ${selector}`);
      }),
      waitForTimeout,
      evaluate: vi
        .fn(() => Promise.resolve(0))
        .mockName("page.evaluate"),
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

    const page = {
      getByTestId: vi
        .fn<Page["getByTestId"]>()
        .mockImplementation((testId: string) => {
          expect(testId).toBe("message-assistant");
          return assistantLocator as unknown as ReturnType<Page["getByTestId"]>;
        }),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);

    const snapshot = await (chatPage as any).captureAssistantSnapshot();

    expect(snapshot).toEqual({
      count: 0,
      latestArtifactCount: 0,
      latestMessageId: null,
      latestMessageText: "",
    });
    expect(assistantLocator.count).toHaveBeenCalledOnce();
  });

  it("captures the latest assistant message payload", async () => {
    const messageContentLocator = {
      innerText: vi.fn().mockResolvedValue("  Hello world  "),
    };
    const artifactLocator = {
      count: vi.fn().mockResolvedValue(2),
    };
    const lastAssistantMessage = {
      getAttribute: vi.fn().mockImplementation(async (attribute: string) => {
        if (attribute === "data-message-id") {
          return "assistant-1";
        }

        if (attribute === "data-message-status") {
          return "completed";
        }

        return null;
      }),
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

    const page = {
      getByTestId: vi
        .fn<Page["getByTestId"]>()
        .mockImplementation((testId: string) => {
          expect(testId).toBe("message-assistant");
          return assistantLocator as unknown as ReturnType<Page["getByTestId"]>;
        }),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);

    const snapshot = await (chatPage as any).captureAssistantSnapshot();

    expect(snapshot).toEqual({
      count: 3,
      latestArtifactCount: 2,
      latestMessageId: 'assistant-1',
      latestMessageText: "Hello world",
    });
    expect(assistantLocator.count).toHaveBeenCalledOnce();
    expect(assistantLocator.nth).toHaveBeenCalledWith(2);
  });

  it("records a snapshot before sending a user message", async () => {
    const order: string[] = [];
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const sendButtonLocator = {
      click: vi.fn(async () => {
        order.push("send-click");
      }),
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
    };
    const page = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-assistant") {
          order.push("assistant-snapshot");
          return assistantLocator;
        }

        if (testId === "stop-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(false),
          };
        }

        if (testId === "send-button") {
          return sendButtonLocator;
        }

        if (testId === "message-user") {
          return {
            count: vi.fn().mockResolvedValue(0),
          };
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          };
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      evaluate: vi
        .fn(() => Promise.resolve(0))
        .mockName("page.evaluate"),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baseline = {
      count: 0,
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
    const composerSpy = vi
      .spyOn(chatPage as any, "waitForComposerReady")
      .mockImplementation(async () => {
        order.push("composer-ready");
        return { sendButtonEnabled: true };
      });
    const waitSpy = vi
      .spyOn(chatPage as any, "waitForChatApiResponse")
      .mockImplementation(async () => {
        order.push("wait");
      });

    await chatPage.sendUserMessage("Hello");

    expect(captureSpy).toHaveBeenCalledOnce();
    expect(composerSpy).toHaveBeenCalledWith("Hello");
    expect(waitSpy).toHaveBeenCalledOnce();
    expect(order.indexOf("capture-call")).toBeLessThan(order.indexOf("send-click"));
    expect((chatPage as any).pendingAssistantSnapshot).toEqual(baseline);
    expect((chatPage as any).pendingUserMessageCount).toBe(0);
  });

  it("submits via Enter when the send button remains disabled", async () => {
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(0),
      nth: vi.fn(),
    };
    const userLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const stopButtonLocator = {
      isVisible: vi.fn().mockResolvedValue(false),
    };
    const sendClick = vi.fn().mockResolvedValue(undefined);
    const sendButtonLocator = {
      click: sendClick,
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
    };
    const pressMock = vi.fn().mockResolvedValue(undefined);
    const inputValueMock = vi.fn().mockResolvedValue("");
    const composerLocator = {
      click: vi.fn(),
      fill: vi.fn(),
      type: vi.fn(),
      inputValue: inputValueMock,
      press: pressMock,
    };
    const suggestedActionsLocator = {
      isVisible: vi.fn().mockResolvedValue(false),
    };

    const page = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "message-assistant") {
          return assistantLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "message-user") {
          return userLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "stop-button") {
          return stopButtonLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "send-button") {
          return sendButtonLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "multimodal-input") {
          return composerLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        if (testId === "suggested-actions") {
          return suggestedActionsLocator as unknown as ReturnType<Page["getByTestId"]>;
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      evaluate: vi.fn().mockResolvedValue(0),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const captureSpy = vi
      .spyOn(chatPage as any, "captureAssistantSnapshot")
      .mockResolvedValue({
        count: 0,
        latestArtifactCount: 0,
        latestMessageId: null,
        latestMessageText: "",
      });
    const prepareSpy = vi.spyOn(chatPage as any, "prepareForGeneration");
    const composerSpy = vi
      .spyOn(chatPage as any, "waitForComposerReady")
      .mockResolvedValue({
        sendButtonEnabled: false,
      });
    const waitSpy = vi
      .spyOn(chatPage as any, "waitForChatApiResponse")
      .mockResolvedValue(undefined);

    await chatPage.sendUserMessage("Hello");

    expect(prepareSpy).toHaveBeenCalledWith({
      composerValueOverride: "Hello",
    });
    expect(waitSpy).toHaveBeenCalledOnce();
    expect(sendClick).not.toHaveBeenCalled();
    expect(pressMock).toHaveBeenCalledWith("Enter");

    captureSpy.mockRestore();
    prepareSpy.mockRestore();
    composerSpy.mockRestore();
    waitSpy.mockRestore();
  });

  it("waits for the stop button when skipping the response await", async () => {
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(0),
      nth: vi.fn(),
    };
    const userLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const stopButtonLocator = {
      isVisible: vi.fn().mockResolvedValue(false),
    };
    const sendButtonLocator = {
      click: vi.fn().mockResolvedValue(undefined),
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
    };
    const composerLocator = {
      click: vi.fn(),
      fill: vi.fn(),
      type: vi.fn(),
      inputValue: vi.fn().mockResolvedValue(""),
    };
    const suggestedActionsLocator = {
      isVisible: vi.fn().mockResolvedValue(false),
    };
    const waitForSelector = vi.fn().mockResolvedValue(undefined);

    const page = {
      getByTestId: vi.fn((testId: string) => {
        switch (testId) {
          case "message-assistant":
            return assistantLocator as unknown as ReturnType<Page["getByTestId"]>;
          case "message-user":
            return userLocator as unknown as ReturnType<Page["getByTestId"]>;
          case "stop-button":
            return stopButtonLocator as unknown as ReturnType<Page["getByTestId"]>;
          case "send-button":
            return sendButtonLocator as unknown as ReturnType<Page["getByTestId"]>;
          case "multimodal-input":
            return composerLocator as unknown as ReturnType<Page["getByTestId"]>;
          case "suggested-actions":
            return suggestedActionsLocator as unknown as ReturnType<Page["getByTestId"]>;
          default:
            throw new Error(`Unexpected test id: ${testId}`);
        }
      }),
      evaluate: vi.fn().mockResolvedValue(0),
      waitForSelector,
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const captureSpy = vi
      .spyOn(chatPage as any, "captureAssistantSnapshot")
      .mockResolvedValue({
        count: 0,
        latestArtifactCount: 0,
        latestMessageId: null,
        latestMessageText: "",
      });
    const prepareSpy = vi.spyOn(chatPage as any, "prepareForGeneration");
    const composerSpy = vi
      .spyOn(chatPage as any, "waitForComposerReady")
      .mockResolvedValue({
        sendButtonEnabled: true,
      });
    const waitSpy = vi
      .spyOn(chatPage as any, "waitForChatApiResponse")
      .mockResolvedValue(undefined);

    await chatPage.sendUserMessage("Hello", { waitForResponse: false });

    expect(prepareSpy).toHaveBeenCalledWith({ composerValueOverride: "Hello" });
    expect(waitSpy).toHaveBeenCalledOnce();
    expect(waitForSelector).toHaveBeenCalledWith(
      '[data-testid="stop-button"]',
      expect.objectContaining({ state: "visible", timeout: 10_000 })
    );

    captureSpy.mockRestore();
    prepareSpy.mockRestore();
    composerSpy.mockRestore();
    waitSpy.mockRestore();
  });

  it("records a snapshot before sending a suggestion message", async () => {
    const order: string[] = [];
    const assistantLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const suggestionLocator = {
      click: vi.fn(async () => {
        order.push("suggestion-click");
      }),
      innerText: vi.fn().mockResolvedValue(DEFAULT_ONBOARDING_SUGGESTION),
      textContent: vi.fn().mockResolvedValue(DEFAULT_ONBOARDING_SUGGESTION),
      getAttribute: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn().mockResolvedValue(""),
    };
    const userMessagesLocator = {
      count: vi.fn().mockResolvedValue(0),
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
          return userMessagesLocator;
        }

        if (testId === "multimodal-input") {
          return {
            click: vi.fn(),
            fill: vi.fn(),
            inputValue: vi.fn().mockResolvedValue("fallback"),
            press: vi.fn().mockResolvedValue(undefined),
          };
        }

        if (testId === "stop-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(false),
          };
        }

        if (testId === "suggested-actions") {
          return { isVisible: vi.fn().mockResolvedValue(true) };
        }

        if (testId === "send-button") {
          return {
            click: vi.fn(),
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          };
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
          };
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      evaluate: vi.fn().mockResolvedValue(0),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);
    const baseline = {
      count: 0,
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

    const originalExpect = ChatPage.expect;
    const toBeVisible = vi.fn().mockResolvedValue(undefined);
    const toHaveCount = vi.fn().mockResolvedValue(undefined);
    ChatPage.expect = vi
      .fn((locator: unknown) => {
        if (locator === suggestionLocator) {
          return { toBeVisible } as any;
        }
        if (locator === userMessagesLocator) {
          return { toHaveCount } as any;
        }
        throw new Error("Unexpected locator passed to ChatPage.expect");
      }) as any;

    try {
      await chatPage.sendUserMessageFromSuggestion();

      expect(captureSpy).toHaveBeenCalledOnce();
      expect(waitSpy).toHaveBeenCalledOnce();
      expect(toBeVisible).toHaveBeenCalledWith({ timeout: 15_000 });
      expect(toHaveCount).toHaveBeenCalledWith(1, { timeout: 7_500 });
      expect(order.indexOf("capture-call")).toBeLessThan(
        order.indexOf("suggestion-click")
      );
      expect((chatPage as any).pendingAssistantSnapshot).toEqual(baseline);
      expect((chatPage as any).pendingUserMessageCount).toBe(0);
    } finally {
      ChatPage.expect = originalExpect;
    }
  });

  it("retries a suggestion when the initial user bubble never appears", async () => {
    const order: string[] = [];
    const suggestionText = DEFAULT_ONBOARDING_SUGGESTION;
    const suggestionLocator = {
      click: vi.fn(async () => {
        order.push("suggestion-click");
      }),
      innerText: vi.fn().mockResolvedValue(suggestionText),
      textContent: vi.fn().mockResolvedValue(suggestionText),
      getAttribute: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn().mockResolvedValue(""),
    };
    const userMessagesLocator = {
      count: vi.fn().mockResolvedValue(0),
    };
    const sendButtonLocator = {
      click: vi.fn(async () => {
        order.push("send-click");
      }),
      isEnabled: vi.fn().mockResolvedValue(true),
      isVisible: vi.fn().mockResolvedValue(true),
    };
    const multimodalLocator = {
      inputValue: vi
        .fn()
        .mockResolvedValueOnce("")
        .mockResolvedValue(suggestionText),
      click: vi.fn(),
      fill: vi.fn(),
      type: vi.fn(),
      press: vi.fn().mockResolvedValue(undefined),
    };
    const stopButtonLocator = {
      isVisible: vi.fn().mockResolvedValue(false),
    };
    const page = {
      getByTestId: vi.fn((testId: string) => {
        if (testId === "suggested-action-0") {
          return suggestionLocator;
        }

        if (testId === "message-user") {
          return userMessagesLocator;
        }

        if (testId === "multimodal-input") {
          return multimodalLocator;
        }

        if (testId === "send-button") {
          return sendButtonLocator;
        }

        if (testId === "stop-button") {
          return stopButtonLocator;
        }

        if (testId === "suggested-actions") {
          return { isVisible: vi.fn().mockResolvedValue(true) };
        }

        throw new Error(`Unexpected test id: ${testId}`);
      }),
      evaluate: vi.fn().mockResolvedValue(0),
    } satisfies Partial<Page>;

    const chatPage = new ChatPage(page as Page);

    const prepareSpy = vi
      .spyOn(chatPage as any, "prepareForGeneration")
      .mockImplementation(async (options?: { composerValueOverride?: string }) => {
        if (options?.composerValueOverride) {
          order.push(`prepare-override:${options.composerValueOverride}`);
        } else {
          order.push("prepare");
        }

        await (chatPage as any).captureAssistantSnapshot();
      });
    const waitSpy = vi
      .spyOn(chatPage as any, "waitForChatApiResponse")
      .mockImplementation(async () => {
        order.push("wait");
      });
    const composerReadySpy = vi
      .spyOn(chatPage as any, "waitForComposerReady")
      .mockImplementation(async (message: string) => {
        order.push(`composer-ready:${message}`);
        return { sendButtonEnabled: true };
      });
    const captureSpy = vi
      .spyOn(chatPage as any, "captureAssistantSnapshot")
      .mockResolvedValue({
        count: 0,
        latestArtifactCount: 0,
        latestMessageId: null,
        latestMessageText: "",
      });

    const originalExpect = ChatPage.expect;
    const toBeVisible = vi.fn().mockResolvedValue(undefined);
    const toHaveCount = vi
      .fn()
      .mockRejectedValueOnce(new Error("no user message"))
      .mockResolvedValueOnce(undefined);

    ChatPage.expect = vi
      .fn((locator: unknown) => {
        if (locator === suggestionLocator) {
          return { toBeVisible } as any;
        }

        if (locator === userMessagesLocator) {
          return { toHaveCount } as any;
        }

        throw new Error("Unexpected locator passed to ChatPage.expect");
      }) as any;

    try {
      await expect(chatPage.sendUserMessageFromSuggestion()).resolves.toBeUndefined();

      expect(captureSpy).toHaveBeenCalledTimes(2);
      expect(prepareSpy).toHaveBeenCalledTimes(2);
      expect(prepareSpy).toHaveBeenNthCalledWith(1, {
        composerValueOverride: suggestionText,
      });
      const secondCallArgs = prepareSpy.mock.calls[1] ?? [];
      expect(secondCallArgs).toHaveLength(0);
      expect(waitSpy).toHaveBeenCalledTimes(2);
      expect(composerReadySpy).toHaveBeenCalledWith(suggestionText);
      expect(sendButtonLocator.click).toHaveBeenCalledTimes(1);
      expect(toBeVisible).toHaveBeenCalledWith({ timeout: 15_000 });
      expect(toHaveCount).toHaveBeenNthCalledWith(1, 1, { timeout: 7_500 });
      expect(toHaveCount).toHaveBeenNthCalledWith(2, 1, { timeout: 10_000 });
      expect(order).toContain("suggestion-click");
      expect(order).toContain(`prepare-override:${suggestionText}`);
      expect(order).toContain("prepare");
      expect(order.filter((label) => label === "wait").length).toBe(2);
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
            count: vi.fn().mockResolvedValue(1),
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

        if (testId === "stop-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(false),
          };
        }

        if (testId === "send-button") {
          return {
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          };
        }

        if (testId === "multimodal-input") {
          return {
            inputValue: vi.fn().mockResolvedValue(""),
            press: vi.fn().mockResolvedValue(undefined),
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
    expect((chatPage as any).pendingUserMessageCount).toBe(1);
  });

  describe("waitForComposerReady", () => {
    it("retypes the message until the composer stabilises and the send button enables", async () => {
      const order: string[] = [];
      const fillMock = vi.fn(async (value: string) => order.push(`fill:${value}`));
      const typeMock = vi.fn(async (value: string) => order.push(`type:${value}`));
      const inputValueMock = vi
        .fn()
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("Hello world")
        .mockResolvedValue("Hello world");
      const isEnabledMock = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      const stopVisibleMock = vi.fn().mockResolvedValue(false);
      const waitForTimeoutMock = vi.fn(async () => {
        order.push("wait");
      });

      const page = {
        getByTestId: vi.fn((testId: string) => {
          if (testId === "multimodal-input") {
            return {
              click: vi.fn(async () => order.push("click")),
              fill: fillMock,
              type: typeMock,
              inputValue: inputValueMock,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "send-button") {
            return {
              isEnabled: isEnabledMock,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "stop-button") {
            return {
              isVisible: stopVisibleMock,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          throw new Error(`Unexpected test id: ${testId}`);
        }),
        waitForTimeout: waitForTimeoutMock,
      } satisfies Partial<Page>;

      const chatPage = new ChatPage(page as Page);

    const result = await (chatPage as any).waitForComposerReady("Hello world", {
      timeout: 1_000,
      pollInterval: 50,
    });

    expect(result).toEqual({ sendButtonEnabled: true });
    expect(fillMock).toHaveBeenNthCalledWith(1, "");
    expect(typeMock).toHaveBeenNthCalledWith(1, "Hello world");
      expect(fillMock).toHaveBeenNthCalledWith(2, "");
      expect(typeMock).toHaveBeenNthCalledWith(2, "Hello world");
      expect(fillMock).toHaveBeenCalledTimes(2);
      expect(typeMock).toHaveBeenCalledTimes(2);
      expect(inputValueMock).toHaveBeenCalledTimes(2);
      expect(isEnabledMock).toHaveBeenCalledTimes(2);
      expect(waitForTimeoutMock).toHaveBeenCalledTimes(1);
      expect(stopVisibleMock).toHaveBeenCalled();
    expect(order[0]).toBe("click");
    expect(order).toContain("wait");
  });

    it("returns the disabled state when the composer stabilises but the send button never enables", async () => {
      const fillMock = vi.fn().mockResolvedValue(undefined);
      const typeMock = vi.fn().mockResolvedValue(undefined);
      const inputValueMock = vi.fn().mockResolvedValue("Hello world");
      const isEnabledMock = vi.fn().mockResolvedValue(false);
      const stopVisibleMock = vi.fn().mockResolvedValue(false);
      const waitForTimeoutMock = vi.fn().mockResolvedValue(undefined);

      const page = {
        getByTestId: vi.fn((testId: string) => {
          if (testId === "multimodal-input") {
            return {
              click: vi.fn(),
              fill: fillMock,
              type: typeMock,
              inputValue: inputValueMock,
              press: vi.fn(),
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "send-button") {
            return {
              isEnabled: isEnabledMock,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          if (testId === "stop-button") {
            return {
              isVisible: stopVisibleMock,
            } as unknown as ReturnType<Page["getByTestId"]>;
          }

          throw new Error(`Unexpected test id: ${testId}`);
        }),
        waitForTimeout: waitForTimeoutMock,
      } satisfies Partial<Page>;

      const chatPage = new ChatPage(page as Page);
      const synchroniseSpy = vi
        .spyOn(chatPage as any, "synchroniseComposerValue")
        .mockResolvedValue(undefined);

      const nowValues = [0, 0, 2_000];
      let callIndex = 0;
      const nowSpy = vi
        .spyOn(Date, "now")
        .mockImplementation(() => nowValues[Math.min(callIndex++, nowValues.length - 1)]);

      const result = await (chatPage as any).waitForComposerReady("Hello world", {
        timeout: 1_000,
        pollInterval: 50,
      });

      expect(result).toEqual({ sendButtonEnabled: false });
      expect(waitForTimeoutMock).toHaveBeenCalled();
      expect(isEnabledMock).toHaveBeenCalled();
      expect(stopVisibleMock).toHaveBeenCalled();
      synchroniseSpy.mockRestore();
      nowSpy.mockRestore();
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
