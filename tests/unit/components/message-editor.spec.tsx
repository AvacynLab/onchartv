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

vi.mock("@/app/(chat)/actions", () => ({
  deleteTrailingMessages: vi.fn().mockResolvedValue(undefined),
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
  });

  it("flushes the edited prompt before triggering a regeneration", async () => {
    let currentMessages: ChatMessage[] = [baseMessage];
    const setMessages: MessageEditorProps["setMessages"] = (updater) => {
      currentMessages =
        typeof updater === "function"
          ? updater(currentMessages)
          : updater;
      return currentMessages;
    };

    const regenerate = vi.fn().mockResolvedValue(undefined);
    const setMode = vi.fn();

    render(
      <MessageEditor
        message={baseMessage}
        regenerate={regenerate}
        setMessages={setMessages}
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

    expect(currentMessages[0]?.parts[0]).toMatchObject({
      type: "text",
      text: "Edited reasoning prompt",
    });
    expect(regenerate).toHaveBeenCalledTimes(1);
  });
});
