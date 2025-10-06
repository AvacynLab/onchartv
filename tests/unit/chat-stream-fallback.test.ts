import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  buildFallbackStreamResponse,
  normaliseAssistantMessage,
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

test("normaliseAssistantMessage reconstructs text from delta fragments", () => {
  const message = {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "text-delta", delta: "Hello" },
      { type: "appendMessage", message: " world" },
      { type: "text", text: "" },
      { type: "text", text: { text: "" } },
    ],
  } as any;

  const normalised = normaliseAssistantMessage(message);

  assert.equal(Array.isArray(normalised.parts), true);

  const textPart = normalised.parts.find(
    (part: any) => part && part.type === "text"
  );

  assert.equal(textPart?.text, "Hello world");
});

test("normaliseAssistantMessage extracts deeply nested value content", () => {
  const message = {
    id: "assistant-2",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: {
          value: " Primary insight ",
        },
      },
      {
        type: "text-delta",
        delta: { value: " (delta)" },
      },
    ],
    content: [
      {
        type: "text",
        text: {
          message: { value: "" },
        },
      },
    ],
  } as any;

  const normalised = normaliseAssistantMessage(message);

  const textPart = normalised.parts.find(
    (part: any) => part && part.type === "text"
  );

  assert.equal(textPart?.text, "Primary insight (delta)");
});
