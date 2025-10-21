import { describe, expect, it } from "vitest";

import {
  deriveAssistantMessageStatus,
  type AssistantStatusComputation,
} from "@/lib/chat/message-status";

describe("deriveAssistantMessageStatus", () => {
  const baseContext: Omit<AssistantStatusComputation, "index" | "messageStatus" | "role"> & {
    role?: AssistantStatusComputation["role"];
  } = {
    latestAssistantIndex: 2,
    chatStatus: "ready",
  };

  it("forces the latest assistant bubble to streaming when the chat is streaming", () => {
    const status = deriveAssistantMessageStatus({
      index: 2,
      latestAssistantIndex: baseContext.latestAssistantIndex,
      chatStatus: "streaming",
      messageStatus: "completed",
      role: "assistant",
    });

    expect(status).toBe("streaming");
  });

  it("defaults to completed when the SDK omits a status", () => {
    const status = deriveAssistantMessageStatus({
      index: 1,
      latestAssistantIndex: baseContext.latestAssistantIndex,
      chatStatus: baseContext.chatStatus,
      messageStatus: undefined,
      role: "assistant",
    });

    expect(status).toBe("completed");
  });

  it("preserves explicit non-streaming statuses provided by the SDK", () => {
    const status = deriveAssistantMessageStatus({
      index: 0,
      latestAssistantIndex: baseContext.latestAssistantIndex,
      chatStatus: baseContext.chatStatus,
      messageStatus: "in_progress",
      role: "assistant",
    });

    expect(status).toBe("in_progress");
  });

  it("returns the original status for non-assistant messages", () => {
    const status = deriveAssistantMessageStatus({
      index: 0,
      latestAssistantIndex: baseContext.latestAssistantIndex,
      chatStatus: baseContext.chatStatus,
      messageStatus: undefined,
      role: "user",
    });

    expect(status).toBeUndefined();
  });

  it("resets lingering streaming statuses to completed once the chat is idle", () => {
    const status = deriveAssistantMessageStatus({
      index: 2,
      latestAssistantIndex: baseContext.latestAssistantIndex,
      chatStatus: baseContext.chatStatus,
      messageStatus: "streaming",
      role: "assistant",
    });

    expect(status).toBe("completed");
  });
});
