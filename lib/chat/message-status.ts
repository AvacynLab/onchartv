import type { UseChatHelpers } from "@ai-sdk/react";

import type { ChatMessage } from "@/lib/types";

/**
 * Context required to derive the lifecycle attribute for a rendered message.
 * The helper is deliberately independent from React so it can be unit-tested
 * without mounting the chat surface.
 */
export type AssistantStatusComputation = {
  /** Index of the message currently being rendered. */
  index: number;
  /** Index of the last assistant bubble currently visible. */
  latestAssistantIndex: number;
  /** Lifecycle reported by the chat transport (e.g. `"streaming"`). */
  chatStatus: UseChatHelpers<ChatMessage>["status"];
  /** Optional status already attached to the message by the SDK. */
  messageStatus: ChatMessage["status"];
  /** Role associated with the message (assistant, user, tool, …). */
  role: ChatMessage["role"];
};

/**
 * Compute the status that should be surfaced through `data-message-status` for
 * the provided message.  Inline edit regenerations often reuse the existing
 * assistant bubble which means the upstream SDK occasionally forgets to set the
 * lifecycle back to `"streaming"`.  Falling back to a deterministic value keeps
 * Playwright synchronisation stable while still honouring explicit statuses when
 * they are provided.
 */
export function deriveAssistantMessageStatus({
  index,
  latestAssistantIndex,
  chatStatus,
  messageStatus,
  role,
}: AssistantStatusComputation): ChatMessage["status"] {
  if (role !== "assistant") {
    return messageStatus;
  }

  const isLatestAssistant = index === latestAssistantIndex;

  if (chatStatus === "streaming" && isLatestAssistant) {
    return "streaming";
  }

  if (messageStatus && messageStatus !== "streaming") {
    return messageStatus;
  }

  return "completed";
}
