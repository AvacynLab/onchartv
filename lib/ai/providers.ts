import { customProvider, extractReasoningMiddleware, wrapLanguageModel } from "ai";
import { isTestEnvironment } from "../constants";
import { isPlaywrightLikeEnvironment } from "./playwright-env";

type CreateOpenAI = typeof import("@ai-sdk/openai").createOpenAI;

const OPENAI_MODEL_ID = "gpt-5-nano";
const isClient = typeof window !== "undefined";
const openaiApiKey = process.env.OPENAI_API_KEY;
const isPlaywrightEnvironment = isPlaywrightLikeEnvironment(process.env);

function createMockProvider() {
  /**
   * Next.js attempts to statically analyze `require` calls during the build.
   * Using `eval` defers module resolution to runtime so the bundle skips our
   * test-only helpers while still letting local unit tests `require` them.
   */
  const nodeRequire = eval("require") as NodeJS.Require;
  const modelsModuleId = isTestEnvironment ? "./models.test" : "./models.mock";
  const models = nodeRequire(modelsModuleId);
  const {
    artifactModel,
    chatModel,
    reasoningModel,
    titleModel,
  } = models;
  return customProvider({
    languageModels: {
      "chat-model": chatModel,
      "chat-model-reasoning": reasoningModel,
      "title-model": titleModel,
      "artifact-model": artifactModel,
    },
  });
}

const shouldUseMocks =
  isClient || isTestEnvironment || isPlaywrightEnvironment;

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

if (!shouldUseMocks && !openaiApiKey) {
  throw new Error("OPENAI_API_KEY is not set");
}

const openaiProvider = !shouldUseMocks
  ? createOpenAI!({ apiKey: openaiApiKey! })
  : null;

export const myProvider = shouldUseMocks
  ? createMockProvider()
  : customProvider({
      languageModels: {
        "chat-model": openaiProvider!.languageModel(OPENAI_MODEL_ID),
        "chat-model-reasoning": wrapLanguageModel({
          model: openaiProvider!.languageModel(OPENAI_MODEL_ID),
          middleware: extractReasoningMiddleware({ tagName: "think" }),
        }),
        "title-model": openaiProvider!.languageModel(OPENAI_MODEL_ID),
        "artifact-model": openaiProvider!.languageModel(OPENAI_MODEL_ID),
      },
    });
