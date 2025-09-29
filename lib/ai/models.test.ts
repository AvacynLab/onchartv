import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { getResponseChunksByPrompt } from "@/tests/prompts/utils";

// The hermetic Playwright suite relies on these deterministic models to avoid
// touching the real OpenAI API. We keep the mocked streams snappy so the tests
// do not spend tens of seconds idling between chunks while still exercising the
// same code-paths as production. A 25ms initial delay roughly mimics the first
// token appearing while keeping the total runtime acceptable for the long chat
// spec.
const STREAM_INITIAL_DELAY_MS = 25;
const STREAM_CHUNK_DELAY_MS = 25;

export const chatModel = new MockLanguageModelV2({
  doGenerate: async () => ({
    rawCall: { rawPrompt: null, rawSettings: {} },
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    content: [{ type: "text", text: "Hello, world!" }],
    warnings: [],
  }),
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      chunkDelayInMs: STREAM_CHUNK_DELAY_MS,
      initialDelayInMs: STREAM_INITIAL_DELAY_MS,
      chunks: getResponseChunksByPrompt(prompt),
    }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  }),
});

export const reasoningModel = new MockLanguageModelV2({
  doGenerate: async () => ({
    rawCall: { rawPrompt: null, rawSettings: {} },
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    content: [{ type: "text", text: "Hello, world!" }],
    warnings: [],
  }),
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      chunkDelayInMs: STREAM_CHUNK_DELAY_MS,
      initialDelayInMs: STREAM_INITIAL_DELAY_MS,
      chunks: getResponseChunksByPrompt(prompt, true),
    }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  }),
});

export const titleModel = new MockLanguageModelV2({
  doGenerate: async () => ({
    rawCall: { rawPrompt: null, rawSettings: {} },
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    content: [{ type: "text", text: "This is a test title" }],
    warnings: [],
  }),
  doStream: async () => ({
    stream: simulateReadableStream({
      chunkDelayInMs: STREAM_CHUNK_DELAY_MS,
      initialDelayInMs: STREAM_INITIAL_DELAY_MS,
      chunks: [
        { id: "1", type: "text-start" },
        { id: "1", type: "text-delta", delta: "This is a test title" },
        { id: "1", type: "text-end" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 3, outputTokens: 10, totalTokens: 13 },
        },
      ],
    }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  }),
});

export const artifactModel = new MockLanguageModelV2({
  doGenerate: async () => ({
    rawCall: { rawPrompt: null, rawSettings: {} },
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    content: [{ type: "text", text: "Hello, world!" }],
    warnings: [],
  }),
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      chunkDelayInMs: STREAM_CHUNK_DELAY_MS,
      initialDelayInMs: STREAM_INITIAL_DELAY_MS,
      chunks: getResponseChunksByPrompt(prompt),
    }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  }),
});
