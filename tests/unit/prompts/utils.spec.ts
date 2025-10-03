import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";

import { getResponseChunksByPrompt } from "@/tests/prompts/utils";

/**
 * The fallback branch activates whenever a prompt bypasses the curated
 * Playwright fixtures. We assert that the helper still emits the full streaming
 * lifecycle so the chat UI can settle instead of hanging indefinitely.
 */
describe("getResponseChunksByPrompt", () => {
  it("returns a complete stream when the prompt is unknown", () => {
    const unknownPrompt: ModelMessage = {
      role: "user",
      content: [{ type: "text", text: "Do you know me?" }],
    };

    const chunks = getResponseChunksByPrompt([unknownPrompt]);
    const chunkTypes = chunks.map((chunk) => chunk.type);

    expect(chunkTypes).toContain("text-start");
    expect(chunkTypes).toContain("text-delta");
    expect(chunkTypes).toContain("text-end");
    expect(chunkTypes).toContain("finish");

    const finishChunk = chunks.find((chunk) => chunk.type === "finish");
    expect(finishChunk).toMatchObject({ finishReason: "stop" });
  });
});
