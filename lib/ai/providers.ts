import {
  APICallError,
  type LanguageModelV2CallOptions,
  type LanguageModelV2Middleware,
} from "@ai-sdk/provider";
import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from "ai";

type NodeModule = typeof import("module");

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

type MockLanguageModelModule = typeof import("./models.mock");

function createMockProvider() {
  if (isNextBuild) {
    /**
     * During the production build Next.js evaluates the provider even though no
     * requests are executed. Returning a lightweight inline model avoids the
     * `eval('require')` path and keeps the build hermetic when fixtures are not
     * bundled alongside the compiled output.
     */
    const createBuildTimeModel = () =>
      ({
        specificationVersion: "v2",
        provider: "mock",
        modelId: "build-mock",
        supportedUrls: {},
        supportsImageUrls: false,
        supportsStructuredOutputs: false,
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          content: [{ type: "text", text: "" }],
          warnings: [],
        }),
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      } as const);

    return customProvider({
      languageModels: {
        "chat-model": createBuildTimeModel(),
        "chat-model-reasoning": createBuildTimeModel(),
        "title-model": createBuildTimeModel(),
        "artifact-model": createBuildTimeModel(),
      } as unknown as Record<string, never>,
    });
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

  const models = loadMockLanguageModels({
    loadModule,
    testingModels,
    isMockTestingEnvironment,
  });
  const { artifactModel, chatModel, reasoningModel, titleModel } = models;
  return customProvider({
    languageModels: {
      "chat-model": chatModel,
      "chat-model-reasoning": reasoningModel,
      "title-model": titleModel,
      "artifact-model": artifactModel,
    },
  });
}

function loadMockLanguageModels({
  loadModule,
  testingModels,
  isMockTestingEnvironment,
}: {
  readonly loadModule: <T>(moduleId: string) => T;
  readonly testingModels: MockLanguageModelModule | null;
  readonly isMockTestingEnvironment: boolean;
}): MockLanguageModelModule {
  if (isMockTestingEnvironment && testingModels) {
    return testingModels;
  }

  try {
    return loadModule<MockLanguageModelModule>("./models.mock");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
      throw error;
    }

    return createInlineMockLanguageModels(loadModule);
  }
}

function createInlineMockLanguageModels(
  loadModule: <T>(moduleId: string) => T
): MockLanguageModelModule {
  const { simulateReadableStream } = loadModule<typeof import("ai")>("ai");
  const { MockLanguageModelV2 } = loadModule<typeof import("ai/test")>(
    "ai/test"
  );

  const createModel = (responseText: string = "Hello, world!") =>
    new MockLanguageModelV2({
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        content: [{ type: "text", text: responseText }],
        warnings: [],
      }),
      doStream: async () => ({
        stream: simulateReadableStream({
          /**
           * The inline fallback mirrors the behaviour from `models.mock.ts` so
           * Playwright and Vitest continue to observe the same deterministic
           * events even when the bundler accidentally tree-shakes the original
           * module. Keeping the mocked chunks identical avoids accidental
           * expectation drift between local runs and CI.
           */
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
          chunks: [
            { id: "mock-1", type: "text-start" },
            { id: "mock-1", type: "text-delta", delta: responseText },
            { id: "mock-1", type: "text-end" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            },
          ],
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    });

  const inlineModels: MockLanguageModelModule = {
    chatModel: createModel(),
    reasoningModel: createModel(),
    titleModel: createModel("This is a test title"),
    artifactModel: createModel(),
  };

  return inlineModels;
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
