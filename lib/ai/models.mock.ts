import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";

/**
 * Creates a lightweight mock language model compatible with the v2 provider
 * interface. The responses stay deterministic so unit tests that rely on the
 * default mock provider remain stable while still exercising the streaming
 * code-paths.
 */
const createMockModel = (responseText: string = "Hello, world!") =>
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
         * We skip artificial delays so tests complete quickly while still
         * yielding the same event structure as the real provider streams.
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

export const chatModel = createMockModel();
export const reasoningModel = createMockModel();
export const titleModel = createMockModel("This is a test title");
export const artifactModel = createMockModel();
