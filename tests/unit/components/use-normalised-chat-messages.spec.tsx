import React, { useEffect, useState } from "react";
import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/lib/types";
import { useNormaliseChatMessages } from "@/lib/chat/use-normalised-chat-messages";
import type { IdentifierPatch } from "@/lib/chat/message-identifiers";

function Harness({
  chatId,
  initialMessages,
  onMessagesChange,
  onIdentifierPatches,
}: {
  chatId: string;
  initialMessages: ChatMessage[];
  onMessagesChange?: (messages: ChatMessage[]) => void;
  onIdentifierPatches?: (patches: readonly IdentifierPatch[]) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  useNormaliseChatMessages({
    chatId,
    messages,
    setMessages,
    onIdentifierPatches,
  });

  return null;
}

describe("useNormaliseChatMessages", () => {
  it("n'applique aucun correctif lorsque tous les messages possèdent déjà un identifiant", async () => {
    const onMessagesChange = vi.fn();
    const onIdentifierPatches = vi.fn();

    const assistant: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Bonjour" }],
      metadata: { createdAt: "2025-12-14T10:00:00.000Z" },
    };

    render(
      <Harness
        chatId="chat-clean"
        initialMessages={[assistant]}
        onMessagesChange={onMessagesChange}
        onIdentifierPatches={onIdentifierPatches}
      />
    );

    await waitFor(() => {
      expect(onMessagesChange).toHaveBeenCalledTimes(1);
    });

    const [messages] = onMessagesChange.mock.calls.at(-1) ?? [];
    expect(messages).toBeDefined();
    expect(messages).toBe(onMessagesChange.mock.calls[0][0]);
    expect(messages?.[0]).toBe(assistant);
    expect(onIdentifierPatches).not.toHaveBeenCalled();
  });

  it("synthétise un identifiant stable et relaie les correctifs lorsqu'un message en est dépourvu", async () => {
    const onMessagesChange = vi.fn();
    const onIdentifierPatches = vi.fn();

    const createdAt = "2025-12-14T11:00:00.000Z";
    const assistantWithoutId: ChatMessage = {
      // Le SDK peut omettre l'identifiant tout en exposant les métadonnées.
      id: "",
      role: "assistant",
      parts: [{ type: "text", text: "Hello" }],
      metadata: { createdAt },
    };

    render(
      <Harness
        chatId="chat-synthetic"
        initialMessages={[assistantWithoutId]}
        onMessagesChange={onMessagesChange}
        onIdentifierPatches={onIdentifierPatches}
      />
    );

    await waitFor(() => {
      const latestCall = onMessagesChange.mock.calls.at(-1);
      expect(latestCall).toBeDefined();
      const [messages] = latestCall ?? [];
      expect(messages?.[0]?.id).toBe(`chat-synthetic-synthetic-0-${createdAt}`);
    });

    expect(onIdentifierPatches).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          fallbackId: `chat-synthetic-synthetic-0-${createdAt}`,
          index: 0,
          role: "assistant",
        }),
      ])
    );
  });
});
