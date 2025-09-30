import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  Object.assign(process.env, originalEnv);

  delete process.env.PLAYWRIGHT;
  delete process.env.CI_PLAYWRIGHT;
  delete process.env.PLAYWRIGHT_TEST_BASE_URL;
  delete process.env.NEXT_PUBLIC_PLAYWRIGHT;
  delete process.env.OPENAI_MODEL_ID;
  delete process.env.OPENAI_REASONING_MODEL_ID;
  delete process.env.OPENAI_TITLE_MODEL_ID;
  delete process.env.OPENAI_ARTIFACT_MODEL_ID;
  delete process.env.OPENAI_API_KEY;
}

describe("ai provider configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
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
});
