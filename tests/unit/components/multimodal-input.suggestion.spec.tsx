import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { MultimodalInput } from "@/components/multimodal-input";
import type { Attachment, ChatMessage } from "@/lib/types";

/**
 * Exercise the suggestion dispatch flow in isolation so we guarantee the click
 * handler triggers `sendMessage` even though the controlled textarea stays
 * empty. The e2e suite depends on this behaviour to kick off streaming without
 * typing into the composer first.
 */

vi.mock("usehooks-ts", () => ({
  useWindowSize: () => ({ width: 1024, height: 768 }),
  useLocalStorage: <T,>(key: string, initialValue: T) => {
    const setValue = vi.fn();
    return [initialValue, setValue] as const;
  },
}));

vi.mock("@/components/ui/select", () => ({
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/elements/prompt-input", async () => {
  const actual = await vi.importActual<typeof import("@/components/elements/prompt-input")>(
    "@/components/elements/prompt-input"
  );

  return {
    ...actual,
    PromptInput: ({ children, onSubmit }: any) => (
      <form onSubmit={onSubmit}>{typeof children === "function" ? children({}) : children}</form>
    ),
    PromptInputTextarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea data-testid="multimodal-input" {...props} />
    ),
    PromptInputSubmit: ({ children, ...props }: any) => (
      <button data-testid="send-button" {...props}>
        {children}
      </button>
    ),
    PromptInputToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PromptInputTools: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PromptInputModelSelect: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PromptInputModelSelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/lib/ai/models", () => ({
  chatModels: [
    { id: "chat-model", name: "Chat", description: "" },
    { id: "chat-model-reasoning", name: "Reasoning", description: "" },
  ],
}));

vi.mock("@/lib/ai/providers", () => ({
  myProvider: {
    languageModel: () => ({})
  }
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/preview-attachment", () => ({
  PreviewAttachment: ({ attachment }: { attachment: Attachment }) => (
    <div>{attachment.name}</div>
  ),
}));

vi.mock("@/components/elements/context", () => ({
  Context: () => <div />,
}));

vi.mock("@/components/icons", () => ({
  ArrowUpIcon: () => <span />, 
  ChevronDownIcon: () => <span />, 
  CpuIcon: () => <span />,
  PaperclipIcon: () => <span />,
  StopIcon: () => <span />,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("MultimodalInput suggested actions", () => {
  const baseProps = {
    chatId: "chat-id",
    input: "",
    setInput: vi.fn(),
    status: "ready" as const,
    stop: vi.fn(),
    attachments: [] as Attachment[],
    setAttachments: vi.fn(),
    messages: [] as ChatMessage[],
    setMessages: vi.fn(),
    className: undefined,
    selectedVisibilityType: "private" as const,
    selectedModelId: "chat-model",
    onModelChange: vi.fn(),
    focusSignal: 0,
    usage: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches sendMessage when a suggestion is clicked", async () => {
    const sendMessage = vi.fn();

    render(
      <MultimodalInput
        {...baseProps}
        sendMessage={sendMessage}
      />
    );

    const suggestion = await screen.findByTestId("suggested-action-0");

    await act(async () => {
      fireEvent.click(suggestion);
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      role: "user",
    });
  });
});
