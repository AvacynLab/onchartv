import { describe, expect, it } from "vitest";

import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from "@/lib/ai/models.mock";

/**
 * The mock models power development builds and Playwright runs. This smoke test
 * ensures the fixtures remain aligned with the provider v2 contract so
 * TypeScript safety and runtime behaviour stay in sync.
 */
describe("mock language models", () => {
  it("expose v2-compatible metadata", () => {
    for (const model of [chatModel, reasoningModel, titleModel, artifactModel]) {
      expect(model.specificationVersion).toBe("v2");
      expect(model.provider).toBe("mock-provider");
      expect(typeof model.doGenerate).toBe("function");
      expect(typeof model.doStream).toBe("function");
    }
  });
});
