import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  buildFallbackStreamResponse,
  __test as streamFallbackTestUtils,
} from "../../lib/chat/stream-fallback";

const textDecoder = new TextDecoder();

async function readStream(stream: ReadableStream<unknown> | null) {
  if (!stream) {
    return "";
  }

  const reader = stream.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (typeof value === "string") {
      buffer += value;
    } else if (value instanceof Uint8Array) {
      buffer += textDecoder.decode(value, { stream: true });
    } else if (Array.isArray(value)) {
      buffer += value
        .map((chunk) =>
          typeof chunk === "string"
            ? chunk
            : chunk instanceof Uint8Array
              ? textDecoder.decode(chunk, { stream: true })
              : ""
        )
        .join("");
    }
  }

  return buffer;
}

test("buildFallbackStreamResponse polls until a fresh assistant reply is available", async () => {
  const chatId = "chat-node-test";
  const resumeRequestedAt = new Date("2024-01-01T00:00:30Z");

  let attempts = 0;

  const responsePromise = buildFallbackStreamResponse(chatId, resumeRequestedAt, {
    getMessagesByChatId: async () => {
      attempts += 1;

      if (attempts < 3) {
        return [];
      }

      return [
        {
          id: "assistant-message",
          chatId,
          role: "assistant",
          parts: [
            { type: "text", text: "Recovered answer" },
          ],
          createdAt: new Date(resumeRequestedAt.getTime() - 4_000),
          updatedAt: new Date(resumeRequestedAt.getTime() - 4_000),
        } as any,
      ];
    },
  });

  await delay(streamFallbackTestUtils.FALLBACK_LOOKUP_DELAY_MS * 2);

  const response = await responsePromise;
  const payload = await readStream(response.body);

  assert.ok(attempts >= 3, "should retry until the assistant reply is persisted");
  assert.ok(
    payload.includes("Recovered answer"),
    "fallback stream should replay the assistant message"
  );
});
