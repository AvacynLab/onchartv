import { describe, expect, it } from "vitest";

import { collectOpenAIEnvVars } from "../../utils/openai-env";

describe("collectOpenAIEnvVars", () => {
  it("returns an empty object when no OpenAI variables are present", () => {
    expect(collectOpenAIEnvVars({})).toEqual({});
  });

  it("strips whitespace and omits empty values", () => {
    const env = {
      OPENAI_API_KEY: "   sk-test   ",
      OPENAI_BASE_URL: "   ",
      OPENAI_ORGANIZATION: "org_123",
      SOME_OTHER_VAR: "ignored",
    } as NodeJS.ProcessEnv;

    expect(collectOpenAIEnvVars(env)).toEqual({
      OPENAI_API_KEY: "sk-test",
      OPENAI_ORGANIZATION: "org_123",
    });
  });

  it("propagates every supported OpenAI override when provided", () => {
    const env = {
      OPENAI_API_KEY: "sk-key",
      OPENAI_BASE_URL: "https://example.test/v1",
      OPENAI_ORGANIZATION: "org_456",
      OPENAI_PROJECT: "proj_789",
      OPENAI_MODEL_ID: "gpt-4o-mini",
      OPENAI_REASONING_MODEL_ID: "o1-preview",
      OPENAI_TITLE_MODEL_ID: "gpt-4o-mini",
      OPENAI_ARTIFACT_MODEL_ID: "gpt-4o-mini",
    } as NodeJS.ProcessEnv;

    expect(collectOpenAIEnvVars(env)).toEqual({
      OPENAI_API_KEY: "sk-key",
      OPENAI_BASE_URL: "https://example.test/v1",
      OPENAI_ORGANIZATION: "org_456",
      OPENAI_PROJECT: "proj_789",
      OPENAI_MODEL_ID: "gpt-4o-mini",
      OPENAI_REASONING_MODEL_ID: "o1-preview",
      OPENAI_TITLE_MODEL_ID: "gpt-4o-mini",
      OPENAI_ARTIFACT_MODEL_ID: "gpt-4o-mini",
    });
  });
});
