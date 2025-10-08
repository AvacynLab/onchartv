import { beforeEach, describe, expect, it, vi } from "vitest";

const primaryLanguageModel = { modelId: "primary-model" } as const;
const fallbackLanguageModel = { modelId: "fallback-model" } as const;

const streamTextMock = vi.hoisted(() => vi.fn());

// The chat route imports several helpers from the `ai` SDK. For this unit
// suite we only need `streamText`, but we provide lightweight stubs for the
// other functions so the module can initialise without throwing.
vi.mock("ai", () => ({
  createUIMessageStream: vi.fn(),
  JsonToSseTransformStream: vi.fn(),
  smoothStream: vi.fn(),
  stepCountIs: vi.fn((steps: number) => steps),
  streamText: streamTextMock,
  generateId: vi.fn(() => "mock-id"),
}));

const primaryProvider = {
  languageModel: vi.fn(() => primaryLanguageModel),
};

const fallbackProvider = {
  languageModel: vi.fn(() => fallbackLanguageModel),
};

vi.mock("@/lib/ai/providers", () => ({
  myProvider: primaryProvider,
  createHermeticMockProvider: vi.fn(() => fallbackProvider),
}));

describe("streamChatResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PLAYWRIGHT;
    delete process.env.PLAYWRIGHT_TEST_BASE_URL;
    delete process.env.CI_PLAYWRIGHT;
    delete process.env.NEXT_PUBLIC_PLAYWRIGHT;
    delete process.env.HERMETIC_CHAT_PROVIDER;
  });

  it("streams with the primary provider when no error occurs", async () => {
    const { streamChatResponse } = await import(
      "@/lib/ai/stream-chat-response"
    );

    const streamOptions = {
      system: "test",
      messages: [],
      // The stop condition is irrelevant for these unit assertions; a noop
      // function keeps the shape consistent with the runtime object.
      stopWhen: () => false,
      experimental_activeTools: [],
      experimental_transform: undefined,
      tools: {},
      experimental_telemetry: { isEnabled: false, functionId: "test" },
      onFinish: vi.fn(),
    } as any;

    const expectedResult = { id: "primary" };
    streamTextMock.mockResolvedValueOnce(expectedResult);

    const result = await streamChatResponse({
      selectedChatModel: "chat-model",
      streamOptions,
    });

    expect(result).toBe(expectedResult);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock).toHaveBeenCalledWith({
      ...streamOptions,
      model: primaryLanguageModel,
    });
  });

  it("falls back to the hermetic provider on network errors", async () => {
    const { streamChatResponse } = await import(
      "@/lib/ai/stream-chat-response"
    );
    const { createHermeticMockProvider } = await import("@/lib/ai/providers");

    const streamOptions = {
      system: "test",
      messages: [],
      stopWhen: () => false,
      experimental_activeTools: [],
      experimental_transform: undefined,
      tools: {},
      experimental_telemetry: { isEnabled: false, functionId: "test" },
      onFinish: vi.fn(),
    } as any;

    const networkError = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ENETUNREACH" },
    });

    streamTextMock.mockRejectedValueOnce(networkError);
    const fallbackResult = { id: "fallback" };
    streamTextMock.mockResolvedValueOnce(fallbackResult);

    const result = await streamChatResponse({
      selectedChatModel: "chat-model",
      streamOptions,
    });

    expect(result).toBe(fallbackResult);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(streamTextMock.mock.calls[1]?.[0]?.model).toBe(fallbackLanguageModel);
    expect(createHermeticMockProvider).toHaveBeenCalledTimes(1);
  });

  it("prefers the hermetic provider outright when the test environment flag is set", async () => {
    const { streamChatResponse } = await import(
      "@/lib/ai/stream-chat-response"
    );
    const { createHermeticMockProvider } = await import("@/lib/ai/providers");

    process.env.PLAYWRIGHT = "true";

    const streamOptions = {
      system: "test",
      messages: [],
      stopWhen: () => false,
      experimental_activeTools: [],
      experimental_transform: undefined,
      tools: {},
      experimental_telemetry: { isEnabled: false, functionId: "test" },
      onFinish: vi.fn(),
    } as any;

    const hermeticResult = { id: "hermetic" };
    streamTextMock.mockResolvedValueOnce(hermeticResult);

    const result = await streamChatResponse({
      selectedChatModel: "chat-model",
      streamOptions,
    });

    expect(result).toBe(hermeticResult);
    expect(createHermeticMockProvider).toHaveBeenCalledTimes(1);
    expect(primaryProvider.languageModel).not.toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock.mock.calls[0]?.[0]?.model).toBe(
      fallbackLanguageModel
    );
  });

  it("uses the hermetic provider when only the public Playwright flag is set", async () => {
    const { streamChatResponse } = await import(
      "@/lib/ai/stream-chat-response"
    );
    const { createHermeticMockProvider } = await import("@/lib/ai/providers");

    process.env.NEXT_PUBLIC_PLAYWRIGHT = "true";

    const streamOptions = {
      system: "test",
      messages: [],
      stopWhen: () => false,
      experimental_activeTools: [],
      experimental_transform: undefined,
      tools: {},
      experimental_telemetry: { isEnabled: false, functionId: "test" },
      onFinish: vi.fn(),
    } as any;

    const hermeticResult = { id: "next-public-hermetic" };
    streamTextMock.mockResolvedValueOnce(hermeticResult);

    const result = await streamChatResponse({
      selectedChatModel: "chat-model",
      streamOptions,
    });

    expect(result).toBe(hermeticResult);
    expect(createHermeticMockProvider).toHaveBeenCalledTimes(1);
    expect(primaryProvider.languageModel).not.toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock.mock.calls[0]?.[0]?.model).toBe(
      fallbackLanguageModel
    );
  });

  it("uses the hermetic provider when the explicit hermetic override is present", async () => {
    const { streamChatResponse } = await import(
      "@/lib/ai/stream-chat-response"
    );
    const { createHermeticMockProvider } = await import("@/lib/ai/providers");

    process.env.HERMETIC_CHAT_PROVIDER = "true";

    const streamOptions = {
      system: "test",
      messages: [],
      stopWhen: () => false,
      experimental_activeTools: [],
      experimental_transform: undefined,
      tools: {},
      experimental_telemetry: { isEnabled: false, functionId: "test" },
      onFinish: vi.fn(),
    } as any;

    const hermeticResult = { id: "override-hermetic" };
    streamTextMock.mockResolvedValueOnce(hermeticResult);

    const result = await streamChatResponse({
      selectedChatModel: "chat-model",
      streamOptions,
    });

    expect(result).toBe(hermeticResult);
    expect(createHermeticMockProvider).toHaveBeenCalledTimes(1);
    expect(primaryProvider.languageModel).not.toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock.mock.calls[0]?.[0]?.model).toBe(
      fallbackLanguageModel
    );
  });

  it("falls back when the primary provider throws an AggregateError", async () => {
    const { streamChatResponse } = await import(
      "@/lib/ai/stream-chat-response"
    );
    const { createHermeticMockProvider } = await import("@/lib/ai/providers");

    const streamOptions = {
      system: "test",
      messages: [],
      stopWhen: () => false,
      experimental_activeTools: [],
      experimental_transform: undefined,
      tools: {},
      experimental_telemetry: { isEnabled: false, functionId: "test" },
      onFinish: vi.fn(),
    } as any;

    const aggregate = Object.assign(
      new AggregateError([
        Object.assign(new Error("socket unreachable"), { code: "ENETUNREACH" }),
      ]),
      { code: "ENETUNREACH" }
    );

    streamTextMock.mockRejectedValueOnce(aggregate);
    const fallbackResult = { id: "aggregate-fallback" };
    streamTextMock.mockResolvedValueOnce(fallbackResult);

    const result = await streamChatResponse({
      selectedChatModel: "chat-model",
      streamOptions,
    });

    expect(result).toBe(fallbackResult);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(streamTextMock.mock.calls[1]?.[0]?.model).toBe(fallbackLanguageModel);
    expect(createHermeticMockProvider).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-network errors from the primary provider", async () => {
    const { streamChatResponse } = await import(
      "@/lib/ai/stream-chat-response"
    );

    const streamOptions = {
      system: "test",
      messages: [],
      stopWhen: () => false,
      experimental_activeTools: [],
      experimental_transform: undefined,
      tools: {},
      experimental_telemetry: { isEnabled: false, functionId: "test" },
      onFinish: vi.fn(),
    } as any;

    const unexpected = new Error("boom");
    streamTextMock.mockRejectedValueOnce(unexpected);

    await expect(
      streamChatResponse({ selectedChatModel: "chat-model", streamOptions })
    ).rejects.toBe(unexpected);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });
});

describe("isHermeticNetworkError", () => {
  it("detects fetch failures with ENET errors", async () => {
    const {
      __test: { isHermeticNetworkError },
    } = await import("@/lib/ai/stream-chat-response");

    const error = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ENETUNREACH" },
    });

    expect(isHermeticNetworkError(error)).toBe(true);
  });

  it("detects ECONN style socket failures", async () => {
    const {
      __test: { isHermeticNetworkError },
    } = await import("@/lib/ai/stream-chat-response");

    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1"), {
      code: "ECONNREFUSED",
    });

    expect(isHermeticNetworkError(error)).toBe(true);
  });

  it("detects AggregateErrors without explicit ENET codes", async () => {
    const {
      __test: { isHermeticNetworkError },
    } = await import("@/lib/ai/stream-chat-response");

    const aggregate = Object.assign(
      new AggregateError([
        Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        Object.assign(new Error("connect ECONNRESET"), { errno: "ECONNRESET" }),
      ]),
      { message: "AggregateError: network failure" }
    );

    expect(isHermeticNetworkError(aggregate)).toBe(true);
  });

  it("detects DNS lookup errors bubbling up through errno", async () => {
    const {
      __test: { isHermeticNetworkError },
    } = await import("@/lib/ai/stream-chat-response");

    const error = Object.assign(new Error("getaddrinfo EAI_AGAIN api.provider"), {
      errno: "EAI_AGAIN",
    });

    expect(isHermeticNetworkError(error)).toBe(true);
  });

  it("ignores unrelated errors", async () => {
    const {
      __test: { isHermeticNetworkError },
    } = await import("@/lib/ai/stream-chat-response");

    expect(isHermeticNetworkError(new Error("boom"))).toBe(false);
  });
});
