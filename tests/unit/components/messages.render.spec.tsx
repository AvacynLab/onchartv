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
});

const { Messages } = await import("@/components/messages");
