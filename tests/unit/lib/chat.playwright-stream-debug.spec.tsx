// @vitest-environment jsdom

import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { logChatDataPartDebug, useChatPlaywrightStreamDebug } from "@/lib/chat/playwright-stream-debug";
import type { ChatMessage } from "@/lib/types";

const logPlaywrightStreamDebugMock = vi.fn();

vi.mock("@/lib/playwright-debug", () => ({
  logPlaywrightStreamDebug: (
    ...args: Parameters<typeof logPlaywrightStreamDebugMock>
  ) => logPlaywrightStreamDebugMock(...args),
}));

describe("chat Playwright stream debug helpers", () => {
  beforeEach(() => {
    logPlaywrightStreamDebugMock.mockReset();
  });

  afterEach(() => {
    logPlaywrightStreamDebugMock.mockReset();
  });

  it("logs data-part diagnostics", () => {
    logChatDataPartDebug({ type: "data-usage", data: { total: 42 } });

    expect(logPlaywrightStreamDebugMock).toHaveBeenCalledWith(
      "chat-component",
      "data-part",
      expect.any(Function)
    );

    const payloadFactory = logPlaywrightStreamDebugMock.mock.calls[0][2];
    expect(payloadFactory()).toEqual({
      partType: "data-usage",
      hasData: true,
    });
  });

  it("emits status and message summaries when the hook observes updates", async () => {
    const TestHarness = ({
      messages,
      status,
    }: {
      messages: ChatMessage[] | null | undefined;
      status: "idle" | "loading" | "streaming" | "submitted";
    }) => {
      const { safeMessages, messageCount } = useChatPlaywrightStreamDebug({
        messages,
        status,
      });

      return (
        <div data-testid="summary" data-count={messageCount}>
          {safeMessages.length}
        </div>
      );
    };

    const assistantMessage: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Hello" }],
    } as ChatMessage;

    const { rerender, getByTestId } = render(
      <TestHarness messages={undefined} status="idle" />
    );

    await waitFor(() => {
      expect(logPlaywrightStreamDebugMock).toHaveBeenCalledWith(
        "chat-component",
        "status-change",
        expect.any(Function)
      );
    });

    rerender(<TestHarness messages={[assistantMessage]} status="streaming" />);

    await waitFor(() => {
      expect(logPlaywrightStreamDebugMock).toHaveBeenCalledWith(
        "chat-component",
        "messages-summary",
        expect.any(Function)
      );
    });

    const summaryPayloadCall = [...logPlaywrightStreamDebugMock.mock.calls]
      .reverse()
      .find(([, event]) => event === "messages-summary");
    expect(summaryPayloadCall).toBeTruthy();
    const summaryPayloadFactory = summaryPayloadCall?.[2];
    expect(summaryPayloadFactory?.()).toEqual({
      count: 1,
      messages: [
        {
          id: "assistant-1",
          index: 0,
          partTypes: ["text"],
          role: "assistant",
          status: null,
          textPreview: ["Hello"],
        },
      ],
    });

    expect(getByTestId("summary").dataset.count).toBe("1");
  });

  it("logs message status transitions for Playwright diagnostics", async () => {
    const Harness = ({ status }: { status?: ChatMessage["status"] }) => {
      useChatPlaywrightStreamDebug({
        messages: [
          {
            id: "assistant-42",
            role: "assistant",
            parts: [{ type: "text", text: "Streaming..." }],
            status,
          } as ChatMessage,
        ],
        status: "streaming",
      });

      return null;
    };

    const { rerender } = render(<Harness status="streaming" />);

    await waitFor(() => {
      expect(
        logPlaywrightStreamDebugMock
          .mock.calls.filter(([, event]) => event === "message-status-transition")
          .length
      ).toBeGreaterThan(0);
    });

    rerender(<Harness status="completed" />);

    await waitFor(() => {
      const transitionCalls = logPlaywrightStreamDebugMock.mock.calls.filter(
        ([, event]) => event === "message-status-transition"
      );

      const latestCall = transitionCalls.at(-1);
      expect(latestCall).toBeTruthy();

      const payloadFactory = latestCall?.[2];
      expect(payloadFactory?.()).toEqual({
        id: "assistant-42",
        index: 0,
        role: "assistant",
        previousStatus: "streaming",
        nextStatus: "completed",
      });
    });
  });
});
