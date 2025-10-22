import { describe, expect, it } from "vitest";

import { deriveMessageParts } from "@/lib/ai/messages/derive-message-parts";
import type { ChatMessage } from "@/lib/types";

describe("deriveMessageParts", () => {
  it("returns structured parts when present", () => {
    const message: ChatMessage = {
      id: "user-001",
      role: "user",
      parts: [
        { type: "text", text: "Why is the sky blue?" },
      ],
      metadata: {},
    };

    expect(deriveMessageParts(message)).toEqual(message.parts);
  });

  it("falls back to legacy content arrays", () => {
    const message = {
      parts: [],
      content: [
        { type: "text", text: "Why is grass green?" },
        { type: "text", text: "Why is the sky blue?" },
      ],
    } as unknown as ChatMessage;

    expect(deriveMessageParts(message)).toEqual(message.content);
  });

  it("returns an empty collection when neither representation is available", () => {
    const message = {
      parts: [],
    } as unknown as ChatMessage;

    expect(deriveMessageParts(message)).toEqual([]);
  });
});
