import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/types";
import {
  normaliseMessageIdentifiers,
  prepareNormalisedMessageUpdate,
  resolveStableMessageId,
} from "@/lib/chat/message-identifiers";

describe("message identifier normalisation", () => {
  it("reuses the provided identifier when present", () => {
    const message = {
      id: "assistant-123",
      role: "assistant",
      metadata: { createdAt: new Date().toISOString() },
      parts: [],
    } as unknown as ChatMessage;

    const { id, isSynthetic } = resolveStableMessageId({
      chatId: "chat-1",
      index: 0,
      message,
    });

    expect(id).toBe("assistant-123");
    expect(isSynthetic).toBe(false);
  });

  it("synthesises a deterministic identifier when missing", () => {
    const createdAt = "2025-12-11T00:00:00.000Z";
    const message = {
      role: "assistant",
      metadata: { createdAt },
      parts: [],
    } as unknown as ChatMessage;

    const { id, isSynthetic } = resolveStableMessageId({
      chatId: "chat-42",
      index: 3,
      message,
    });

    expect(id).toBe(`chat-42-synthetic-3-${createdAt}`);
    expect(isSynthetic).toBe(true);
  });

  it("falls back to an unknown timestamp when metadata is absent", () => {
    const message = {
      role: "assistant",
      parts: [{ type: "text", text: "Hello" }],
    } as unknown as ChatMessage;

    const { id, isSynthetic } = resolveStableMessageId({
      chatId: "chat-7",
      index: 1,
      message,
    });

    expect(id).toBe("chat-7-synthetic-1-unknown");
    expect(isSynthetic).toBe(true);
  });

  it("patches assistant messages without identifiers", () => {
    const createdAt = "2025-12-11T00:00:00.000Z";
    const messages = [
      {
        role: "assistant",
        metadata: { createdAt },
        parts: [],
      },
      {
        id: "user-1",
        role: "user",
        metadata: { createdAt },
        parts: [],
      },
    ] as unknown as ChatMessage[];

    const { messages: patched, patches, clonedArray } = normaliseMessageIdentifiers({
      chatId: "chat-99",
      messages,
    });

    expect(patches).toEqual([
      {
        fallbackId: "chat-99-synthetic-0-2025-12-11T00:00:00.000Z",
        index: 0,
        role: "assistant",
      },
    ]);

    expect(patched[0]?.id).toBe(
      "chat-99-synthetic-0-2025-12-11T00:00:00.000Z",
    );
    expect(patched[1]?.id).toBe("user-1");
    expect(clonedArray).toBe(false);
  });

  it("returns the original array when all identifiers are present", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        metadata: { createdAt: new Date().toISOString() },
        parts: [],
      },
    ] as unknown as ChatMessage[];

    const result = normaliseMessageIdentifiers({
      chatId: "chat-7",
      messages,
    });

    expect(result.messages).toBe(messages);
    expect(result.patches).toHaveLength(0);
    expect(result.clonedArray).toBe(false);
  });

  it("clones the array when messages are non-extensible", () => {
    const createdAt = new Date("2025-12-11T00:00:00.000Z").toISOString();
    const frozenAssistant = Object.freeze({
      role: "assistant",
      metadata: { createdAt },
      parts: [],
    });

    const messages = [
      frozenAssistant,
      {
        id: "user-1",
        role: "user",
        metadata: { createdAt },
        parts: [],
      },
    ] as unknown as ChatMessage[];

    const { messages: patched, patches, clonedArray } = normaliseMessageIdentifiers({
      chatId: "chat-123",
      messages,
    });

    expect(clonedArray).toBe(true);
    expect(patches).toHaveLength(1);
    expect(patched).not.toBe(messages);
    expect(patched[0]?.id).toBe(`chat-123-synthetic-0-${createdAt}`);
    expect(patched[1]?.id).toBe("user-1");
  });

  it("prepares an updated collection when identifiers are missing", () => {
    const createdAt = "2025-12-12T00:00:00.000Z";
    const assistant = {
      role: "assistant",
      metadata: { createdAt },
      parts: [],
    } as unknown as ChatMessage;

    const inputMessages = [assistant] as ChatMessage[];

    const prepared = prepareNormalisedMessageUpdate({
      chatId: "chat-prepare",
      messages: inputMessages,
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.messages).not.toBeNull();
    expect(prepared?.patches).toEqual([
      {
        fallbackId: "chat-prepare-synthetic-0-2025-12-12T00:00:00.000Z",
        index: 0,
        role: "assistant",
      },
    ]);

    expect(prepared?.messages).not.toBe(inputMessages);
    expect(prepared?.messages[0]?.id).toBe(
      "chat-prepare-synthetic-0-2025-12-12T00:00:00.000Z",
    );
  });

  it("returns null when every message already has a stable identifier", () => {
    const messages = [
      {
        id: "assistant-existing",
        role: "assistant",
        metadata: { createdAt: new Date().toISOString() },
        parts: [],
      },
    ] as unknown as ChatMessage[];

    const prepared = prepareNormalisedMessageUpdate({
      chatId: "chat-existing",
      messages,
    });

    expect(prepared).toBeNull();
  });

  it("retains newer entries when normalising streamed messages", () => {
    const createdAt = "2025-12-13T00:00:00.000Z";
    const messages = [
      {
        id: "user-1",
        role: "user",
        metadata: { createdAt },
        parts: [],
      },
      {
        role: "assistant",
        metadata: { createdAt },
        parts: [],
      },
      {
        id: "assistant-2",
        role: "assistant",
        metadata: { createdAt },
        parts: [{ type: "text", text: "Most recent" }],
      },
    ] as unknown as ChatMessage[];

    const prepared = prepareNormalisedMessageUpdate({
      chatId: "chat-stream",
      messages,
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.messages).toHaveLength(3);
    expect(prepared?.messages[1]?.id).toBe("chat-stream-synthetic-1-2025-12-13T00:00:00.000Z");
    expect(prepared?.messages[2]?.id).toBe("assistant-2");
    expect(prepared?.messages[2]?.parts?.[0]?.text).toBe("Most recent");
  });
});
