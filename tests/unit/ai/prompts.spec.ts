import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { systemPrompt, type RequestHints } from "@/lib/ai/prompts";
import { __resetFinanceManualCacheForTests } from "@/lib/ai/system-prompts";

// Deterministic geo hints to satisfy the prompt builder expectations during
// tests; specific coordinates are irrelevant for the assertions.
const baseRequestHints: RequestHints = {
  latitude: "0",
  longitude: "0",
  city: "Test City",
  country: "TC",
};

describe("systemPrompt", () => {
  beforeEach(() => {
    __resetFinanceManualCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("appends the finance manual when the feature flag is enabled", () => {
    vi.stubEnv("FEATURE_FINANCE", "true");

    const prompt = systemPrompt({
      selectedChatModel: "chat-model",
      requestHints: baseRequestHints,
    });

    expect(prompt).toContain("Finance Analysis Manual");
    expect(prompt).toContain("You are not a financial advisor");
    expect(prompt).toContain("Past performance is not indicative of future results.");
  });

  it("omits the finance manual when the feature flag is disabled", () => {
    vi.stubEnv("FEATURE_FINANCE", "false");

    const prompt = systemPrompt({
      selectedChatModel: "chat-model",
      requestHints: baseRequestHints,
    });

    expect(prompt).not.toContain("Finance Analysis Manual");
  });

  it("still applies guardrails for reasoning models", () => {
    vi.stubEnv("FEATURE_FINANCE", "true");

    const prompt = systemPrompt({
      selectedChatModel: "chat-model-reasoning",
      requestHints: baseRequestHints,
    });

    expect(prompt).not.toContain("Artifacts is a special user interface mode");
    expect(prompt).toContain("Finance Analysis Manual");
  });
});
