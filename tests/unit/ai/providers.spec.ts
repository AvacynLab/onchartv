import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOpenAIMock = vi.fn(() => ({
  languageModel: vi.fn((modelId: string) => ({
    specificationVersion: "v2",
    provider: "openai-mock",
    modelId,
    defaultObjectGenerationMode: "tool",
    supportedUrls: [],
    supportsImageUrls: false,
    supportsStructuredOutputs: false,
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  })),
}));

const originalEnv = { ...process.env };
const nodeRequire = createRequire(import.meta.url);
const originalEval = globalThis.eval;

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  Object.assign(process.env, originalEnv);

  delete process.env.PLAYWRIGHT;
  delete process.env.CI_PLAYWRIGHT;
  delete process.env.PLAYWRIGHT_TEST_BASE_URL;
  delete process.env.NEXT_PUBLIC_PLAYWRIGHT;
  delete process.env.NEXT_PHASE;
  delete process.env.OPENAI_MODEL_ID;
  delete process.env.OPENAI_REASONING_MODEL_ID;
  delete process.env.OPENAI_TITLE_MODEL_ID;
  delete process.env.OPENAI_ARTIFACT_MODEL_ID;
  delete process.env.OPENAI_API_KEY;
}

describe("ai provider configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@ai-sdk/openai", () => ({
      createOpenAI: createOpenAIMock,
    }));
    resetEnv();
    createOpenAIMock.mockClear();
    globalThis.eval = ((expression: string) => {
      if (expression === "require") {
        return (moduleId: string) => {
          if (moduleId === "@ai-sdk/openai") {
            return { createOpenAI: createOpenAIMock };
          }

          if (moduleId === "./models.mock") {
            return nodeRequire("@/lib/ai/models.mock");
          }

          if (moduleId === "./models.testing") {
            return nodeRequire("@/lib/ai/models.testing");
          }

          return nodeRequire(moduleId);
        };
      }

      return originalEval(expression);
    }) as typeof globalThis.eval;
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
    globalThis.eval = originalEval;
  });

  it("throws when OPENAI_MODEL_ID is missing", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    await expect(import("@/lib/ai/providers")).rejects.toThrow(
      /OPENAI_MODEL_ID is not set/
    );
  });

  it("maps capability-specific model identifiers", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL_ID = "gpt-4.1-mini";
    process.env.OPENAI_REASONING_MODEL_ID = "o3-mini";
    process.env.OPENAI_TITLE_MODEL_ID = "gpt-4o-mini";
    process.env.OPENAI_ARTIFACT_MODEL_ID = "gpt-4.1-mini-json";

    const { myProvider } = await import("@/lib/ai/providers");

    expect(myProvider.languageModel("chat-model").modelId).toBe(
      "gpt-4.1-mini"
    );
    expect(myProvider.languageModel("chat-model-reasoning").modelId).toBe(
      "o3-mini"
    );
    expect(myProvider.languageModel("title-model").modelId).toBe(
      "gpt-4o-mini"
    );
    expect(myProvider.languageModel("artifact-model").modelId).toBe(
      "gpt-4.1-mini-json"
    );
  });

  it("falls back to the base chat model when overrides are absent", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL_ID = "gpt-4.1-mini";

    const { myProvider } = await import("@/lib/ai/providers");

    const modelIds = [
      "chat-model",
      "chat-model-reasoning",
      "title-model",
      "artifact-model",
    ].map((capability) => myProvider.languageModel(capability).modelId);

    expect(new Set(modelIds)).toEqual(new Set(["gpt-4.1-mini"]));
  });

  it("falls back to the mock models in Playwright environments", async () => {
    process.env.PLAYWRIGHT = "true";
    process.env.NEXT_PHASE = "phase-production-build";

    const { myProvider } = await import("@/lib/ai/providers");

    const chatModel = myProvider.languageModel("chat-model");

    expect(chatModel.provider).toBe("mock");
    expect(chatModel.specificationVersion).toBe("v2");
  });
});

describe("loadMockLanguageModels", () => {
  const importTestHelpers = async () => {
    const module = await import("@/lib/ai/providers");
    return module.__test;
  };

  beforeEach(() => {
    vi.resetModules();
    resetEnv();
    process.env.PLAYWRIGHT = "true";
  });

  afterEach(() => {
    resetEnv();
  });

  it("falls back to inline mocks when the bundled fixtures are missing", async () => {
    const moduleNotFound = Object.assign(new Error("missing"), {
      code: "MODULE_NOT_FOUND",
    });

    const __test = await importTestHelpers();

    const result = __test.loadMockLanguageModels({
      loadModule: <T,>(moduleId: string): T => {
        if (moduleId === "./models.mock") {
          throw moduleNotFound;
        }

        return require(moduleId) as T;
      },
      testingModels: null,
      isMockTestingEnvironment: false,
    });

    const { MockLanguageModelV2 } = require("ai/test") as typeof import("ai/test");

    expect(result.chatModel).toBeInstanceOf(MockLanguageModelV2);
    expect(result.reasoningModel).toBeInstanceOf(MockLanguageModelV2);
    expect(result.artifactModel).toBeInstanceOf(MockLanguageModelV2);
    expect(result.titleModel).toBeInstanceOf(MockLanguageModelV2);

    const generation = await result.titleModel.doGenerate?.({} as never);

    expect(generation?.content[0]).toMatchObject({
      type: "text",
      text: "This is a test title",
    });
  });

  it("reuses dedicated Playwright fixtures when they are available", async () => {
    const sentinel = Symbol("mock-model");

    const testingModels = {
      chatModel: { sentinel },
      reasoningModel: { sentinel },
      titleModel: { sentinel },
      artifactModel: { sentinel },
    } as unknown as typeof import("@/lib/ai/models.mock");

    const __test = await importTestHelpers();

    const result = __test.loadMockLanguageModels({
      loadModule: () => {
        throw new Error("loadModule should not be invoked when mocks already exist");
      },
      testingModels,
      isMockTestingEnvironment: true,
    });

    expect(result).toBe(testingModels);
  });
});
