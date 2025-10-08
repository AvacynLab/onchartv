import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env } as NodeJS.ProcessEnv;

function restoreEnvironment() {
  process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
}

describe("myProvider hermetic mode", () => {
  beforeEach(() => {
    vi.resetModules();
    restoreEnvironment();
  });

  afterEach(() => {
    restoreEnvironment();
  });

  it("uses the inline mock provider when HERMETIC_CHAT_PROVIDER is true", async () => {
    process.env.HERMETIC_CHAT_PROVIDER = "true";

    const module = await import("@/lib/ai/providers");
    const model = module.myProvider.languageModel("chat-model");

    expect(model.provider).toBe("mock-provider");
  });
});
