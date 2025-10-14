import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageEditor } from "@/components/message-editor";
import type { ChatMessage } from "@/lib/types";

type EditableChatMessage = ChatMessage & {
  content?: Array<Record<string, unknown>> | string;
};

// Provide the global React export so mocked components that rely on the legacy
// runtime continue to work under Vitest.
(globalThis as unknown as { React: typeof React }).React = React;

const { deleteTrailingMessagesMock } = vi.hoisted(() => ({
  deleteTrailingMessagesMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/(chat)/actions", () => ({
  deleteTrailingMessages: deleteTrailingMessagesMock,
}));

vi.mock("@/components/toast", () => ({
  toast: vi.fn(),
}));

describe("MessageEditor", () => {
  const baseMessage: EditableChatMessage = {
    id: "message-id",
    role: "user",
    parts: [{ type: "text", text: "Original prompt" }],
    content: [{ type: "text", text: "Original prompt" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as typeof window & {
      __PLAYWRIGHT_CHAT_SIGNALS__?: Array<{
        phase: string;
        timestamp: number;
      }>;
    }).__PLAYWRIGHT_CHAT_SIGNALS__;
  });

  it("flushes the edited prompt before triggering a regeneration", async () => {
    const setMode = vi.fn();
    let messages: ChatMessage[] = [
      baseMessage,
      {
        id: "assistant-message",
        role: "assistant",
        parts: [{ type: "text", text: "It's just blue duh!" }],
      },
    ];

    const setMessages = vi.fn(
      (
        updater:
          | ChatMessage[]
          | ((currentMessages: ChatMessage[]) => ChatMessage[])
      ) => {
        messages =
          typeof updater === "function"
            ? updater(messages)
            : updater;
      }
    );
    const regenerate = vi.fn().mockResolvedValue(undefined);

    render(
      <MessageEditor
        message={baseMessage}
        regenerate={regenerate}
        setMode={setMode}
        setMessages={setMessages}
      />
    );

    const editor = await screen.findByTestId("message-editor");

    await act(async () => {
      fireEvent.change(editor, {
        target: { value: "Edited reasoning prompt" },
      });
    });

    const submit = screen.getByTestId("message-editor-send-button");

    await act(async () => {
      fireEvent.click(submit);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(deleteTrailingMessagesMock).toHaveBeenCalledWith({
      id: baseMessage.id,
    });
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledWith({ messageId: baseMessage.id });
    expect(setMode).toHaveBeenCalledWith("view");

    expect(messages).toEqual([
      {
        ...baseMessage,
        parts: [{ type: "text", text: "Edited reasoning prompt" }],
        content: [{ type: "text", text: "Edited reasoning prompt" }],
      },
    ]);

    const signals = (window as typeof window & {
      __PLAYWRIGHT_CHAT_SIGNALS__?: Array<{ phase: string }>;
    }).__PLAYWRIGHT_CHAT_SIGNALS__;

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "submit" }),
        expect.objectContaining({ phase: "sent" }),
      ])
    );
  });

  it("preserves attachments while resubmitting an edit", async () => {
    const setMode = vi.fn();
    // Define a message that mixes a file part and a text part to ensure the
    // inline edit flow retains non-text payloads when the user resubmits.
    const messageWithAttachment: EditableChatMessage = {
      id: "message-with-file",
      role: "user",
      metadata: { createdAt: "2024-01-01T00:00:00.000Z" },
      parts: [
        {
          type: "file",
          url: "https://example.com/image.png",
          name: "image.png",
          mediaType: "image/png",
        },
        { type: "text", text: "Original prompt" },
      ],
      content: [
        {
          type: "file",
          url: "https://example.com/image.png",
          name: "image.png",
          mediaType: "image/png",
        },
        { type: "text", text: "Original prompt" },
      ],
    };
    let messages: ChatMessage[] = [
      messageWithAttachment,
      {
        id: "assistant-response",
        role: "assistant",
        parts: [{ type: "text", text: "It's just blue duh!" }],
      },
    ];

    const setMessages = vi.fn(
      (
        updater:
          | ChatMessage[]
          | ((currentMessages: ChatMessage[]) => ChatMessage[])
      ) => {
        messages =
          typeof updater === "function"
            ? updater(messages)
            : updater;
      }
    );
    const regenerate = vi.fn().mockResolvedValue(undefined);

    render(
      <MessageEditor
        message={messageWithAttachment}
        regenerate={regenerate}
        setMode={setMode}
        setMessages={setMessages}
      />
    );

    const editor = await screen.findByTestId("message-editor");

    await act(async () => {
      fireEvent.change(editor, {
        target: { value: "Edited attachment prompt" },
      });
    });

    const submit = screen.getByTestId("message-editor-send-button");

    await act(async () => {
      fireEvent.click(submit);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledWith({
      messageId: messageWithAttachment.id,
    });
    expect(setMode).toHaveBeenCalledWith("view");
    expect(deleteTrailingMessagesMock).toHaveBeenCalledWith({
      id: messageWithAttachment.id,
    });

    expect(messages).toEqual([
      {
        ...messageWithAttachment,
        parts: [
          {
            type: "file",
            url: "https://example.com/image.png",
            name: "image.png",
            mediaType: "image/png",
          },
          { type: "text", text: "Edited attachment prompt" },
        ],
        content: [
          {
            type: "file",
            url: "https://example.com/image.png",
            name: "image.png",
            mediaType: "image/png",
          },
          { type: "text", text: "Edited attachment prompt" },
        ],
      },
    ]);
  });
});
