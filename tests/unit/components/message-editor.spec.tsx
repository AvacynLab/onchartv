import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MessageEditor,
  type MessageEditorProps,
} from "@/components/message-editor";
import type { ChatMessage } from "@/lib/types";

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
  const baseMessage: ChatMessage = {
    id: "message-id",
    role: "user",
    parts: [{ type: "text", text: "Original prompt" }],
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
    const sendMessage = vi.fn<ReturnType<MessageEditorProps["sendMessage"]>, Parameters<MessageEditorProps["sendMessage"]>>()
      .mockResolvedValue(undefined);
    const setMode = vi.fn();

    render(
      <MessageEditor
        message={baseMessage}
        sendMessage={sendMessage}
        setMode={setMode}
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

    expect(sendMessage).toHaveBeenCalledWith({
      messageId: baseMessage.id,
      parts: [{ type: "text", text: "Edited reasoning prompt" }],
      role: baseMessage.role,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(setMode).toHaveBeenCalledWith("view");
  });

  it("preserves attachments and surfaces Playwright signals during edits", async () => {
    const sendMessage = vi
      .fn<ReturnType<MessageEditorProps["sendMessage"]>, Parameters<MessageEditorProps["sendMessage"]>>()
      .mockResolvedValue(undefined);
    const setMode = vi.fn();
    const messageWithAttachment: ChatMessage = {
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
    };

    render(
      <MessageEditor
        message={messageWithAttachment}
        sendMessage={sendMessage}
        setMode={setMode}
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

    expect(sendMessage).toHaveBeenCalledWith({
      messageId: messageWithAttachment.id,
      parts: [
        {
          type: "file",
          url: "https://example.com/image.png",
          name: "image.png",
          mediaType: "image/png",
        },
        { type: "text", text: "Edited attachment prompt" },
      ],
      role: messageWithAttachment.role,
      metadata: messageWithAttachment.metadata,
    });

    const signals = (window as typeof window & {
      __PLAYWRIGHT_CHAT_SIGNALS__?: Array<{ phase: string }>;
    }).__PLAYWRIGHT_CHAT_SIGNALS__;

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "submit" }),
        expect.objectContaining({ phase: "sent" }),
      ])
    );
    expect(setMode).toHaveBeenCalledWith("view");
    expect(deleteTrailingMessagesMock).toHaveBeenCalledWith({
      id: messageWithAttachment.id,
    });
  });
});
