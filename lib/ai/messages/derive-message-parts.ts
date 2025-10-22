import type { ChatMessage } from "@/lib/types";

/**
 * Extract a normalised list of message parts from a chat payload. Some legacy
 * clients still submit fragments under the deprecated `content` field instead
 * of the structured `parts` collection. Falling back to that array allows the
 * server to treat both representations uniformly when validating signatures or
 * streaming prompts, without mutating the original payload.
 */
export function deriveMessageParts(
  message: Pick<ChatMessage, "parts"> & { content?: unknown }
): ChatMessage["parts"] {
  if (Array.isArray(message.parts) && message.parts.length > 0) {
    return message.parts as ChatMessage["parts"];
  }

  if (
    "content" in message &&
    Array.isArray((message as { content?: unknown }).content) &&
    (((message as { content?: unknown[] }).content?.length) ?? 0) > 0
  ) {
    return (message as { content: ChatMessage["parts"] }).content;
  }

  return [];
}
