import * as ai from "ai";
import type { ModelMessage } from "ai";
import type { ChatMessage } from "@/lib/types";

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
    if (!message.parts) {
      return message;
    }

    const filteredParts = message.parts.filter((part) => {
      return typeof part.type !== "string" || !part.type.startsWith(FINANCE_DATA_PREFIX);
    });

    if (filteredParts.length === message.parts.length) {
      return message;
    }

    return {
      ...message,
      parts: filteredParts,
    };
  });

  return ai.convertToModelMessages(sanitisedMessages, options);
}
