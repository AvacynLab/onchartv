import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/lib/types";

const logWarningMock = vi.fn();
const logDebugMock = vi.fn();

vi.mock("@/hooks/use-messages", () => ({
  useMessages: () => ({
    containerRef: { current: null },
    endRef: { current: null },
    isAtBottom: true,
    scrollToBottom: vi.fn(),
    hasSentMessage: false,
  }),
}));

vi.mock("@/components/data-stream-provider", () => ({
  useDataStream: () => undefined,
}));

vi.mock("@/lib/feature-flags", () => ({
  isFinanceFeatureEnabledClient: vi.fn(() => false),
}));

vi.mock("@/lib/logging", () => ({
  logWarning: (...args: Parameters<typeof logWarningMock>) =>
    logWarningMock(...args),
}));

vi.mock("@/lib/playwright-debug", () => ({
  logPlaywrightStreamDebug: (...args: Parameters<typeof logDebugMock>) =>
    logDebugMock(...args),
}));

vi.mock("@/components/message", () => ({
  PreviewMessage: ({
    message,
  }: {
    message: ChatMessage;
  }) => (
    <div
      data-testid={`message-${message.role}`}
      data-parts-length={message.parts.length}
    />
  ),
  ThinkingMessage: () => <div data-testid="thinking-message" />,
}));

vi.mock("@/components/greeting", () => ({
  Greeting: () => <div data-testid="greeting" />,
}));

vi.mock("@/components/elements/conversation", () => ({
  Conversation: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="conversation">{children}</div>
  ),
  ConversationContent: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="conversation-content">{children}</div>
  ),
}));

const noop = () => {};

describe("Messages", () => {
  beforeEach(() => {
    logWarningMock.mockClear();
    logDebugMock.mockClear();
  });

  it("renders assistant replies even when the SDK omits the parts array", () => {
    const assistantWithoutParts = {
      id: "assistant-1",
      role: "assistant",
      metadata: { createdAt: new Date().toISOString() },
      parts: undefined,
    } as unknown as ChatMessage;

    render(
      <React.Suspense fallback={null}>
        <Messages
          chatId="chat-1"
          isArtifactVisible={false}
          isReadonly={false}
          messages={[assistantWithoutParts]}
          regenerate={noop as any}
          selectedModelId="chat-model"
          setMessages={noop as any}
          status="ready"
          votes={[]}
        />
      </React.Suspense>
    );

    const assistant = screen.getByTestId("message-assistant");
    expect(assistant).toBeInTheDocument();
    expect(assistant).toHaveAttribute("data-parts-length", "0");

    expect(logWarningMock).toHaveBeenCalledWith(
      "chat:messages",
      "[Messages] message arrived without a parts array; defaulting to empty",
      expect.objectContaining({ messageId: "assistant-1", role: "assistant" })
    );
    expect(screen.queryByTestId("chat-message-fallback")).toBeNull();
  });

  it("synthesises a fallback identifier when the message id is missing", () => {
    const createdAt = new Date().toISOString();
    const assistantWithoutId = {
      role: "assistant",
      metadata: { createdAt },
      parts: [{ type: "text", text: "Hello" }],
    } as unknown as ChatMessage;

    render(
      <React.Suspense fallback={null}>
        <Messages
          chatId="chat-2"
          isArtifactVisible={false}
          isReadonly={false}
          messages={[assistantWithoutId]}
          regenerate={noop as any}
          selectedModelId="chat-model"
          setMessages={noop as any}
          status="ready"
          votes={[]}
        />
      </React.Suspense>
    );

    expect(screen.getByTestId("message-assistant")).toBeInTheDocument();
    expect(logWarningMock).toHaveBeenCalledWith(
      "chat:messages",
      "[Messages] message arrived without a stable id; synthesising fallback",
      expect.objectContaining({
        chatId: "chat-2",
        fallbackMessageId: `chat-2-synthetic-0-${createdAt}`,
        role: "assistant",
      })
    );
  });
});

const { Messages } = await import("@/components/messages");
