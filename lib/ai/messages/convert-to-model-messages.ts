import * as ai from "ai";
import type { ModelMessage } from "ai";
import type { ChatMessage } from "@/lib/types";
import {
  createCanonicalTextPart,
  normaliseUserMessageParts,
} from "@/lib/ai/messages/normalise-user-message-parts";

/**
 * Prefix used by finance artefact data parts. Keeping the prefix centralised
 * avoids subtle typos when we strip transient artefacts prior to calling the
 * AI SDK helper.
 */
const FINANCE_DATA_PREFIX = "data-finance";

/**
 * Wrapper around the AI SDK's `convertToModelMessages` helper that removes any
 * streamed finance artefact data parts before delegating to the upstream
 * implementation. The model only needs textual/tool content; artefact payloads
 * are preserved separately for UI rendering and persistence.
 */
export function convertToModelMessages(
  messages: Array<Omit<ChatMessage, "id">>,
  options?: Parameters<typeof ai.convertToModelMessages>[1]
): ModelMessage[] {
  const sanitisedMessages = messages.map((message) => {
    const candidateParts = deriveCandidateParts(message);

    if (!candidateParts) {
      return stripLegacyContent(message);
    }

    const filteredParts = candidateParts
      .filter((part): part is NonNullable<ChatMessage["parts"]>[number] => {
        if (part == null) {
          return false;
        }

        if (typeof part === "object") {
          const declaredType = (part as { type?: unknown }).type;

          if (typeof declaredType === "string") {
            return !declaredType.startsWith(FINANCE_DATA_PREFIX);
          }
        }

        return true;
      })
      .map((part) => {
        if (typeof part !== "object") {
          return part;
        }

        const hasInputText =
          "input_text" in part &&
          typeof (part as { input_text?: unknown }).input_text === "string";

        const declaredType = (part as { type?: unknown }).type;

        if (hasInputText) {
          const text = (part as { input_text: string }).input_text;

          if (declaredType === "input_text" || declaredType == null) {
            /**
             * Inline edits surface user prompts as `input_text` fragments.
             * Normalising them to the standard text shape keeps the
             * downstream AI SDK helper aware of the freshest user edit.
             */
            return createCanonicalTextPart(part, text);
          }
        }

        return part;
      }) as ChatMessage["parts"];

    const { content: _legacyContent, ...messageWithoutContent } = stripLegacyContent(
      message
    );

    return {
      ...messageWithoutContent,
      parts:
        message.role === "user"
          ? normaliseUserMessageParts(filteredParts)
          : filteredParts,
    } as typeof message;
  });

  return ai.convertToModelMessages(sanitisedMessages, options);
}
function deriveCandidateParts(
  message: Omit<ChatMessage, "id">
): ChatMessage["parts"] | undefined {
  if (Array.isArray(message.parts) && message.parts.length > 0) {
    return message.parts;
  }

  if (
    "content" in message &&
    Array.isArray((message as { content?: unknown }).content) &&
    ((message as { content?: unknown[] }).content?.length ?? 0) > 0
  ) {
    /**
     * Legacy payloads — particularly those restored from persistence — often
     * provide text fragments exclusively via the `content` array. Casting the
     * structure through the shared `parts` type lets downstream helpers stay
     * agnostic of the original field while keeping the clone shallow.
     */
    return (message as { content: ChatMessage["parts"] }).content;
  }

  return undefined;
}

function stripLegacyContent(
  message: Omit<ChatMessage, "id">
): Omit<ChatMessage, "id" | "content"> & { content?: never } {
  const { content: _legacyContent, ...rest } = message as typeof message & {
    content?: unknown;
  };

  return rest;
}
