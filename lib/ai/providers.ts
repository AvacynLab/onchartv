import {
  APICallError,
  type LanguageModelV2,
  type LanguageModelV2CallOptions,
  type LanguageModelV2Middleware,
  type LanguageModelV2StreamPart,
} from "@ai-sdk/provider";
import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
  simulateReadableStream,
} from "ai";

type NodeModule = typeof import("module");
import type { ModelMessage } from "ai";

import { isPlaywrightLikeEnvironment } from "./playwright-env";

type CreateOpenAI = typeof import("@ai-sdk/openai").createOpenAI;

const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 250;

const isClient = typeof window !== "undefined";
/**
 * Next.js sets `NEXT_PHASE=phase-production-build` when statically analysing
 * routes. Treating that phase as "mocked" keeps the build step from crashing
 * when CI or local developers have not provided OpenAI credentials yet.
 */
const isNextBuild = process.env.NEXT_PHASE === "phase-production-build";
const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
const baseChatModelId = process.env.OPENAI_MODEL_ID?.trim();
const reasoningModelId =
  process.env.OPENAI_REASONING_MODEL_ID?.trim() ?? baseChatModelId;
const titleModelId =
  process.env.OPENAI_TITLE_MODEL_ID?.trim() ?? baseChatModelId;
const artifactModelId =
  process.env.OPENAI_ARTIFACT_MODEL_ID?.trim() ?? baseChatModelId;
const env = globalThis.process?.env ?? {};
const isPlaywrightEnvironment = isPlaywrightLikeEnvironment(env);
const isMockTestingEnvironment = Boolean(
  Reflect.get(env, "PLAYWRIGHT_TEST_BASE_URL") ??
    Reflect.get(env, "PLAYWRIGHT") ??
    Reflect.get(env, "CI_PLAYWRIGHT")
);

type MockLanguageModelModule = {
  readonly chatModel: LanguageModelV2;
  readonly reasoningModel: LanguageModelV2;
  readonly titleModel: LanguageModelV2;
  readonly artifactModel: LanguageModelV2;
};

type InlineMockProfile = "basic" | "playwright";

function createMockProvider() {
  const createProviderFromModels = (models: MockLanguageModelModule) => {
    const { artifactModel, chatModel, reasoningModel, titleModel } = models;

    return customProvider({
      languageModels: {
        "chat-model": chatModel,
        "chat-model-reasoning": reasoningModel,
        "title-model": titleModel,
        "artifact-model": artifactModel,
      },
    });
  };

  const shouldPreferTestingFixtures =
    isMockTestingEnvironment || isPlaywrightEnvironment;

  if (isNextBuild || isClient) {
    return createProviderFromModels(
      createInlineMockLanguageModels(
        shouldPreferTestingFixtures ? "playwright" : "basic"
      )
    );
  }

  /**
   * Next.js attempts to statically analyze `require` calls during the build.
   * Using `eval` defers module resolution to runtime so the bundle skips our
   * test-only helpers while still letting local unit tests `require` them.
   */
  /**
   * Using `createRequire` keeps the resolution relative to this module so the
   * Playwright fixtures remain bundled while still compiling under ESM. The
   * previous `eval('require')` indirection prevented Turbopack from including
   * the mock modules, leading to runtime `MODULE_NOT_FOUND` errors during e2e
   * runs.
   */
  const rawRequire = eval("require") as NodeJS.Require & {
    (id: string): unknown;
  };
  const { createRequire } = rawRequire("module") as NodeModule;
  const nodeRequire = createRequire(import.meta.url);
  /**
   * The mocked models live in `models.testing.ts` rather than `models.test.ts`
   * because Next.js strips `.test` modules from the production bundle. Using a
   * distinct suffix keeps the fixtures available to Playwright without being
   * picked up by test runners.
   */
  const loadModule = <T>(moduleId: string) => nodeRequire(moduleId) as T;
  /**
   * Resolve optional mocks without emitting noisy stack traces when the file
   * is absent (e.g. production bundles that strip the Playwright helpers).
   */
  const resolveModule = (moduleId: string) => {
    try {
      return nodeRequire.resolve(moduleId);
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code && code !== "MODULE_NOT_FOUND") {
        throw error;
      }

      return null;
    }
  };
  /**
   * Eagerly try to resolve the Playwright fixtures so the bundler keeps the
   * module in the compiled output. If the file is absent (e.g. in production
   * deployments where we do not ship the testing helpers) we silently fall
   * back to the general-purpose mocks.
   */
  const testingModels = (() => {
    try {
      return loadModule<typeof import("./models.testing")>("./models.testing");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
        throw error;
      }

      return null;
    }
  })();

  try {
    const models = loadMockLanguageModels({
      loadModule,
      resolveModule,
      testingModels,
      profile: shouldPreferTestingFixtures ? "playwright" : "basic",
    });
    return createProviderFromModels(models);
  } catch (error) {
    const maybeErrno = error as NodeJS.ErrnoException;

    /**
     * Some bundlers attempt to evaluate the CommonJS `require` call eagerly and
     * surface a `MODULE_NOT_FOUND` error before we reach `loadMockLanguageModels`.
     * When that happens we still want to fall back to the inline mocks so the
     * finance/chat journeys remain functional during end-to-end tests.
     */
    if (maybeErrno?.code === "MODULE_NOT_FOUND") {
      return createProviderFromModels(
        createInlineMockLanguageModels(
          shouldPreferTestingFixtures ? "playwright" : "basic"
        )
      );
    }

    throw error;
  }
}

function loadMockLanguageModels({
  loadModule,
  resolveModule,
  testingModels,
  profile,
}: {
  readonly loadModule: <T>(moduleId: string) => T;
  readonly resolveModule: (moduleId: string) => string | null;
  readonly testingModels: MockLanguageModelModule | null;
  readonly profile: InlineMockProfile;
}): MockLanguageModelModule {
  if (profile === "playwright" && testingModels) {
    return testingModels;
  }

  const resolvedModuleId = resolveModule("./models.mock");
  if (!resolvedModuleId) {
    return createInlineMockLanguageModels(profile);
  }

  try {
    return loadModule<MockLanguageModelModule>(resolvedModuleId);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code !== "MODULE_NOT_FOUND") {
      throw error;
    }

    return createInlineMockLanguageModels(profile);
  }
}

function createInlineMockLanguageModels(
  profile: InlineMockProfile = "basic"
): MockLanguageModelModule {
  if (profile === "playwright") {
    return createPlaywrightInlineMocks();
  }

  const createModel = (responseText: string = "Hello, world!") =>
    createInlineLanguageModel({
      modelId: "inline-basic",
      responseText,
      chunkBuilder: (_options) => buildBasicChunks(responseText),
    });

  return {
    chatModel: createModel(),
    reasoningModel: createModel(),
    titleModel: createModel("This is a test title"),
    artifactModel: createModel(),
  };
}

function createPlaywrightInlineMocks(): MockLanguageModelModule {
  const createModel = ({
    responseText = "Hello, world!",
    includeReasoning = false,
  }: {
    readonly responseText?: string;
    readonly includeReasoning?: boolean;
  }) =>
    createInlineLanguageModel({
      modelId: "inline-playwright",
      responseText,
      initialDelayInMs: 25,
      chunkDelayInMs: 25,
      chunkBuilder: ({ prompt }) =>
        buildPlaywrightChunks({
          prompt,
          includeReasoning,
          fallbackText: responseText,
        }),
    });

  return {
    chatModel: createModel({}),
    reasoningModel: createModel({ includeReasoning: true }),
    titleModel: createModel({ responseText: "This is a test title" }),
    artifactModel: createModel({}),
  };
}

function createInlineLanguageModel({
  modelId,
  responseText,
  chunkBuilder,
  initialDelayInMs = 0,
  chunkDelayInMs = 0,
}: {
  readonly modelId: string;
  readonly responseText: string;
  readonly chunkBuilder: (
    options: LanguageModelV2CallOptions
  ) => LanguageModelV2StreamPart[];
  readonly initialDelayInMs?: number;
  readonly chunkDelayInMs?: number;
}): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider: "mock-provider",
    modelId,
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text", text: responseText }],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        warnings: [],
      };
    },
    async doStream(options) {
      return {
        stream: simulateReadableStream({
          initialDelayInMs,
          chunkDelayInMs,
          chunks: chunkBuilder(options),
        }),
      };
    },
  };
}

function buildBasicChunks(responseText: string): LanguageModelV2StreamPart[] {
  const id = "mock-1";

  return [
    { id, type: "text-start" },
    { id, type: "text-delta", delta: responseText },
    { id, type: "text-end" },
    buildFinishChunk({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
  ];
}

function buildPlaywrightChunks({
  prompt,
  includeReasoning,
  fallbackText,
}: {
  readonly prompt: ModelMessage[];
  readonly includeReasoning: boolean;
  readonly fallbackText: string;
}): LanguageModelV2StreamPart[] {
  const recentMessage = prompt.at(-1);

  if (!recentMessage) {
    throw new Error("No recent message found!");
  }

  if (includeReasoning) {
    const reasoningChunks = resolveReasoningPrompt(recentMessage);
    if (reasoningChunks) {
      return reasoningChunks;
    }
  }

  const nonReasoningChunks = resolveStandardPrompt(recentMessage);
  if (nonReasoningChunks) {
    return nonReasoningChunks;
  }

  return [
    ...buildTextDeltas(fallbackText),
    buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
  ];
}

function resolveReasoningPrompt(
  message: ModelMessage
): LanguageModelV2StreamPart[] | null {
  if (matchesSingleTextMessage(message, "Why is the sky blue?")) {
    return [
      ...buildReasoningDeltas("The sky is blue because of rayleigh scattering!"),
      ...buildTextDeltas("It's just blue duh!"),
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
    ];
  }

  if (matchesSingleTextMessage(message, "Why is grass green?")) {
    return [
      ...buildReasoningDeltas(
        "Grass is green because of chlorophyll absorption!"
      ),
      ...buildTextDeltas("It's just green duh!"),
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
    ];
  }

  return null;
}

function resolveStandardPrompt(
  message: ModelMessage
): LanguageModelV2StreamPart[] | null {
  if (matchesSingleTextMessage(message, "Thanks!")) {
    return [
      ...buildTextDeltas("You're welcome!"),
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
    ];
  }

  if (matchesSingleTextMessage(message, "Why is grass green?")) {
    return [
      ...buildTextDeltas("It's just green duh!"),
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
    ];
  }

  if (matchesSingleTextMessage(message, "Why is the sky blue?")) {
    return [
      ...buildTextDeltas("It's just blue duh!"),
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
    ];
  }

  if (
    matchesSingleTextMessage(message, "What are the advantages of using Next.js?")
  ) {
    return [
      ...buildTextDeltas("With Next.js, you can ship fast!"),
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
    ];
  }

  if (matchesImageAttachmentPrompt(message)) {
    return [
      ...buildTextDeltas("This painting is by Monet!"),
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
    ];
  }

  if (matchesSingleTextMessage(message, "What's the weather in sf?")) {
    return [
      {
        type: "tool-call",
        toolCallId: "call_weather",
        toolName: "getWeather",
        input: JSON.stringify({ latitude: 37.7749, longitude: -122.4194 }),
      },
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }, "tool-calls"),
    ];
  }

  if (
    matchesSingleTextMessage(message, "Montre BTCUSD 1D avec SMA(50/200)") ||
    matchesSingleTextMessage(message, "/chart BTCUSD 1D")
  ) {
    return [
      {
        type: "tool-call",
        toolCallId: "call_finance_chart",
        toolName: "tool.finance.chart.fetch",
        input: JSON.stringify({
          symbol: "BTCUSD",
          timeframe: "1D",
          limit: 300,
          overlays: [
            { type: "sma", length: 50 },
            { type: "sma", length: 200 },
          ],
        }),
      },
      buildFinishChunk({ inputTokens: 12, outputTokens: 4, totalTokens: 16 }, "tool-calls"),
    ];
  }

  if (
    message.role === "tool" &&
    message.content?.some(
      (part) =>
        part.type === "tool-result" &&
        part.toolCallId === "call_finance_chart" &&
        part.toolName === "tool.finance.chart.fetch"
    )
  ) {
    return [
      ...buildTextDeltas(
        "Graphique BTCUSD quotidien généré avec les moyennes 50 et 200 périodes."
      ),
      buildFinishChunk({ inputTokens: 12, outputTokens: 18, totalTokens: 30 }),
    ];
  }

  if (
    matchesSingleTextMessage(
      message,
      "Backteste SMA 50/200 sur AAPL 2018-01-01 → 2020-12-31"
    ) ||
    matchesSingleTextMessage(
      message,
      "/backtest AAPL 2018-01-01 2020-12-31 50 200"
    )
  ) {
    return [
      {
        type: "tool-call",
        toolCallId: "call_finance_backtest",
        toolName: "tool.finance.strategy.backtest",
        input: JSON.stringify({
          symbol: "AAPL",
          timeframe: "1D",
          range: {
            from: "2018-01-01T00:00:00Z",
            to: "2020-12-31T00:00:00Z",
          },
          strategy: {
            type: "sma-crossover",
            params: { fastPeriod: 50, slowPeriod: 200 },
          },
          risk: {
            initialCapital: 100_000,
            commissionPerTrade: 1,
            slippageBps: 10,
          },
        }),
      },
      buildFinishChunk({ inputTokens: 15, outputTokens: 6, totalTokens: 21 }, "tool-calls"),
    ];
  }

  if (
    message.role === "tool" &&
    message.content?.some(
      (part) =>
        part.type === "tool-result" &&
        part.toolCallId === "call_finance_backtest" &&
        part.toolName === "tool.finance.strategy.backtest"
    )
  ) {
    return [
      ...buildTextDeltas(
        "Backtest SMA 50/200 exécuté sur AAPL entre 2018 et 2020."
      ),
      buildFinishChunk({ inputTokens: 12, outputTokens: 18, totalTokens: 30 }),
    ];
  }

  if (
    matchesSingleTextMessage(message, "Donne fondamentaux + 3 news pour NVDA") ||
    matchesSingleTextMessage(
      message,
      "Summarise NVDA fundamentals using the finance artefacts"
    )
  ) {
    return [
      {
        type: "tool-call",
        toolCallId: "call_finance_fundamentals",
        toolName: "tool.finance.fundamentals.fetch",
        input: JSON.stringify({ symbol: "NVDA" }),
      },
      buildFinishChunk({ inputTokens: 11, outputTokens: 6, totalTokens: 17 }, "tool-calls"),
    ];
  }

  if (
    message.role === "tool" &&
    message.content?.some(
      (part) =>
        part.type === "tool-result" &&
        part.toolCallId === "call_finance_fundamentals" &&
        part.toolName === "tool.finance.fundamentals.fetch"
    )
  ) {
    return [
      {
        type: "tool-call",
        toolCallId: "call_finance_news",
        toolName: "tool.finance.news.fetch",
        input: JSON.stringify({ symbol: "NVDA", limit: 3 }),
      },
      buildFinishChunk({ inputTokens: 10, outputTokens: 4, totalTokens: 14 }, "tool-calls"),
    ];
  }

  if (
    message.role === "tool" &&
    message.content?.some(
      (part) =>
        part.type === "tool-result" &&
        part.toolCallId === "call_finance_news" &&
        part.toolName === "tool.finance.news.fetch"
    )
  ) {
    return [
      ...buildTextDeltas(
        "Synthèse NVDA : fondamentaux clés et trois actualités fournies dans les artefacts."
      ),
      buildFinishChunk({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    ];
  }

  if (matchesSingleTextMessage(message, "Help me write an essay about Silicon Valley")) {
    return buildDocumentCreationChunks();
  }

  if (
    message.role === "tool" &&
    message.content?.some(
      (part) =>
        part.type === "tool-result" && part.toolName === "createDocument"
    )
  ) {
    return [
      ...buildTextDeltas("A document was created and is now visible to the user."),
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
    ];
  }

  if (
    message.role === "tool" &&
    message.content?.some(
      (part) =>
        part.type === "tool-result" && part.toolName === "getWeather"
    )
  ) {
    return [
      ...buildTextDeltas("The current temperature in San Francisco is 17°C."),
      buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
    ];
  }

  return null;
}

function matchesImageAttachmentPrompt(message: ModelMessage): boolean {
  if (message.role !== "user" || !Array.isArray(message.content)) {
    return false;
  }

  if (message.content.length < 2) {
    return false;
  }

  const hasFile = message.content.some((part) => part.type === "file");
  const question = message.content.find(
    (part): part is Extract<ModelMessage["content"][number], { type: "text" }> =>
      part.type === "text"
  );

  return hasFile && question?.text === "Who painted this?";
}

/**
 * Mirror the document authoring helper used by the legacy Playwright fixtures so
 * the inline mocks still exercise the tool streaming life-cycle (input start →
 * deltas → result → finish). The IDs remain deterministic to simplify test
 * assertions without leaking implementation details from the real provider.
 */
function buildDocumentCreationChunks(): LanguageModelV2StreamPart[] {
  const toolCallId = "inline_create_document";

  return [
    { id: toolCallId, type: "tool-input-start", toolName: "createDocument" },
    {
      id: toolCallId,
      type: "tool-input-delta",
      delta: JSON.stringify({
        title: "Essay about Silicon Valley",
        kind: "text",
      }),
    },
    { id: toolCallId, type: "tool-input-end" },
    {
      type: "tool-result",
      toolCallId,
      toolName: "createDocument",
      result: {
        id: "doc_123",
        title: "Essay about Silicon Valley",
        kind: "text",
      },
    },
    buildFinishChunk({ inputTokens: 3, outputTokens: 10, totalTokens: 13 }),
  ];
}

function matchesSingleTextMessage(
  message: ModelMessage,
  expectedText: string
): boolean {
  if (message.role !== "user") {
    return false;
  }

  if (!Array.isArray(message.content) || message.content.length !== 1) {
    return false;
  }

  const [part] = message.content;

  return part.type === "text" && part.text === expectedText;
}

function buildTextDeltas(text: string): LanguageModelV2StreamPart[] {
  const id = "mock-inline";
  const words = text.split(" ");

  return [
    { id, type: "text-start" },
    ...words.map((word) => ({
      id,
      type: "text-delta" as const,
      delta: `${word} `,
    })),
    { id, type: "text-end" },
  ];
}

function buildReasoningDeltas(text: string): LanguageModelV2StreamPart[] {
  const id = "mock-inline-reasoning";
  const words = text.split(" ");

  return [
    { id, type: "reasoning-start" },
    ...words.map((word) => ({
      id,
      type: "reasoning-delta" as const,
      delta: `${word} `,
    })),
    { id, type: "reasoning-end" },
  ];
}

function buildFinishChunk(
  usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  finishReason: "stop" | "tool-calls" = "stop"
): LanguageModelV2StreamPart {
  return {
    type: "finish",
    finishReason,
    usage,
  };
}

export const __test = {
  loadMockLanguageModels,
};

const shouldUseMocks =
  isClient ||
  isMockTestingEnvironment ||
  isPlaywrightEnvironment ||
  isNextBuild;

let createOpenAI: CreateOpenAI | null = null;

if (!shouldUseMocks) {
  try {
    /**
     * Webpack statically analyzes `require` calls. Wrapping the invocation in
     * `eval` prevents the bundler from eagerly resolving `@ai-sdk/openai` when
     * the dependency is intentionally absent (e.g. Playwright runs). At
     * runtime the expression evaluates to Node's native `require`, keeping the
     * production build fully synchronous.
     */
    const nodeRequire = eval("require") as NodeJS.Require;
    const openAiModuleId = "@ai-sdk/openai";

    ({ createOpenAI } = nodeRequire(openAiModuleId));
  } catch (error) {
    /**
     * In production we expect the official OpenAI provider to be available. If
     * the dependency is missing we fail early with a detailed error so the
     * deployment does not silently fall back to the mocked Playwright
     * responses.
     */
    const message =
      "Missing @ai-sdk/openai dependency. Run `pnpm install` to install the official provider.";

    if (process.env.NODE_ENV !== "production") {
      console.warn(message, error);
    }

    throw new Error(message);
  }
}

if (!shouldUseMocks) {
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  if (!baseChatModelId) {
    throw new Error("OPENAI_MODEL_ID is not set");
  }

  if (!reasoningModelId || !titleModelId || !artifactModelId) {
    throw new Error(
      "OPENAI_MODEL_ID is not set for one of the required capabilities"
    );
  }
}

const openaiProvider = !shouldUseMocks
  ? createOpenAI!({
      apiKey: openaiApiKey!,
    })
  : null;

/**
 * Middleware applied to every non-mocked model to enforce safe defaults:
 *   • Clamp `maxOutputTokens` so runaway generations remain bounded.
 *   • Wrap generation/streaming calls with retries and abort-aware timeouts.
 *
 * Using a middleware keeps the resilience logic close to the transport while
 * remaining transparent to the rest of the application.
 */
const guardMiddleware: LanguageModelV2Middleware = {
  middlewareVersion: "v2",
  overrideModelId: ({ model }) => model.modelId,
  overrideProvider: ({ model }) => model.provider,
  transformParams: async ({ params }) => {
    const maximumTokens =
      typeof params.maxOutputTokens === "number"
        ? Math.min(params.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS)
        : DEFAULT_MAX_OUTPUT_TOKENS;

    return { ...params, maxOutputTokens: maximumTokens };
  },
  wrapGenerate: ({ doGenerate, params }) =>
    callWithRetry({
      execute: () =>
        /**
         * `doGenerate` may return a bare thenable, so normalising it through
         * `Promise.resolve` keeps the retry helper working with plain Promises.
         */
        Promise.resolve(doGenerate()),
      params,
      abortSignal: params.abortSignal,
    }),
  wrapStream: ({ doStream, params }) =>
    callWithRetry({
      execute: () =>
        /**
         * Likewise for streaming calls – wrapping the thenable ensures the
         * retry helper can await and retry without tripping on non-Promise
         * return types provided by the AI SDK internals.
         */
        Promise.resolve(doStream()),
      params,
      abortSignal: params.abortSignal,
    }),
};

/**
 * Helper that attaches the guard middleware to an OpenAI model while preserving
 * the reported model identifier for downstream analytics/usage reporting.
 */
const buildGuardedModel = (modelId: string) =>
  wrapLanguageModel({
    model: openaiProvider!.languageModel(modelId),
    middleware: guardMiddleware,
    modelId,
  });

/**
 * Reasoning-capable models emit structured "thinking" traces. We stack the
 * guard middleware underneath the reasoning extractor so timeouts and retries
 * apply to the raw provider calls without interfering with the streamed traces.
 */
const buildReasoningModel = (modelId: string) =>
  wrapLanguageModel({
    model: buildGuardedModel(modelId),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
    modelId,
  });

export const myProvider = shouldUseMocks
  ? createMockProvider()
  : customProvider({
      languageModels: {
        "chat-model": buildGuardedModel(baseChatModelId!),
        "chat-model-reasoning": buildReasoningModel(reasoningModelId!),
        "title-model": buildGuardedModel(titleModelId!),
        "artifact-model": buildGuardedModel(artifactModelId!),
      },
    });

/**
 * Executes the supplied operation with exponential backoff while respecting
 * the caller abort signal. Timeouts are enforced on every attempt so slow
 * network calls never hang indefinitely.
 */
function callWithRetry<T>({
  execute,
  params,
  abortSignal,
}: {
  readonly execute: () => Promise<T>;
  readonly params: LanguageModelV2CallOptions;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<T> {
  const userAbortSignal = abortSignal;
  let attempt = 0;
  let delayMs = RETRY_BASE_DELAY_MS;

  const runAttempt = async (): Promise<T> => {
    if (userAbortSignal?.aborted) {
      throw userAbortSignal.reason ?? createAbortError();
    }

    const originalSignal = params.abortSignal;
    const cleanup = applyTimeoutToParams({
      params,
      originalSignal,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

    try {
      return await execute();
    } finally {
      cleanup();
      params.abortSignal = originalSignal;
    }
  };

  const loop = async (): Promise<T> => {
    try {
      return await runAttempt();
    } catch (error) {
      if (!shouldRetry(error) || attempt >= MAX_RETRIES) {
        throw error;
      }

      attempt += 1;
      const currentDelay = delayMs;
      delayMs *= 2;
      await waitForDelay(currentDelay, userAbortSignal);
      return loop();
    }
  };

  return loop();
}

/** Determines whether an error thrown by the provider merits another attempt. */
function shouldRetry(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    if (error.isRetryable) {
      return true;
    }

    if (typeof error.statusCode === "number") {
      return error.statusCode === 429 || error.statusCode >= 500;
    }
  }

  return false;
}

/**
 * Waits for the requested delay unless the caller aborts first. This keeps
 * retries responsive to client-side cancellations.
 */
function waitForDelay(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      settled = true;
      cleanup();
      resolve();
    }, delayMs);

    const onAbort = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(abortSignal?.reason ?? createAbortError());
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onAbort);
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort();
        return;
      }

      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Replaces the request abort signal with one that enforces a timeout while
 * still reacting to the original caller signal. The returned cleanup handler
 * clears timers and listeners to avoid leaks.
 */
function applyTimeoutToParams({
  params,
  originalSignal,
  timeoutMs,
}: {
  readonly params: LanguageModelV2CallOptions;
  readonly originalSignal: AbortSignal | undefined;
  readonly timeoutMs: number;
}): () => void {
  if (timeoutMs <= 0) {
    return () => {
      /* no-op */
    };
  }

  const controller = new AbortController();
  let cleaned = false;
  const timeoutId = setTimeout(() => {
    if (!controller.signal.aborted) {
      const timeoutError = new Error(
        `The OpenAI request exceeded the ${timeoutMs}ms timeout.`
      );
      timeoutError.name = "AbortError";
      controller.abort(timeoutError);
    }
  }, timeoutMs);

  let relayAbort: (() => void) | undefined;

  if (originalSignal) {
    if (originalSignal.aborted) {
      controller.abort(originalSignal.reason ?? createAbortError());
    } else {
      relayAbort = () => {
        controller.abort(originalSignal.reason ?? createAbortError());
      };
      originalSignal.addEventListener("abort", relayAbort, { once: true });
    }
  }

  const cleanup = () => {
    if (cleaned) {
      return;
    }

    cleaned = true;
    clearTimeout(timeoutId);
    if (relayAbort && originalSignal) {
      originalSignal.removeEventListener("abort", relayAbort);
    }
  };

  controller.signal.addEventListener("abort", cleanup, { once: true });
  params.abortSignal = controller.signal;

  return cleanup;
}

/** Produces a standardised abort error so retries can short-circuit early. */
function createAbortError(): Error {
  const abortError = new Error("The OpenAI request was aborted.");
  abortError.name = "AbortError";
  return abortError;
}
