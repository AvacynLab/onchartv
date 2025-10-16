import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import type { ChatMessage } from "@/lib/types";

/**
 * Message fragments emitted by the AI SDK. The helper accepts both persisted
 * `ChatMessage` parts and the streaming `UIMessagePart` objects surfaced on the
 * client, allowing callers to reuse the same signature logic regardless of the
 * execution environment.
 */
export type MessagePartCandidate =
  | ChatMessage["parts"][number]
  | UIMessagePart<UIDataTypes, UITools>
  | string;

/**
 * Build a lightweight signature for a collection of message parts by
 * concatenating each non-empty text fragment. The operation is intentionally
 * lossy—the goal is to capture the human-visible prompt content so the server
 * can detect mismatches between the client payload and the persisted record.
 */
export const buildMessageTextSignature = (
  parts: ReadonlyArray<MessagePartCandidate> | null | undefined
): string => {
  if (!Array.isArray(parts) || parts.length === 0) {
    return "";
  }

  return parts
    .map((part) => {
      if (!part) {
        return "";
      }

      if (typeof part === "string") {
        return part.trim();
      }

      if (typeof part === "object") {
        if ("text" in part && typeof part.text === "string") {
          return part.text.trim();
        }

        if ("input_text" in part && typeof part.input_text === "string") {
          return part.input_text.trim();
        }
      }

      return "";
    })
    .filter((value) => value.length > 0)
    .join("\n");
};
