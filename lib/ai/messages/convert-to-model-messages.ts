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

    const filteredParts = message.parts
      .filter((part) => {
        return (
          typeof part.type !== "string" ||
          !part.type.startsWith(FINANCE_DATA_PREFIX)
        );
      })
      .map((part) => {
        if (!part || typeof part !== "object") {
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
            return {
              type: "text" as const,
              text,
            };
          }
        }

        return part;
      });

    if (filteredParts.length === message.parts.length) {
      return {
        ...message,
        parts: filteredParts,
      };
    }

    return {
      ...message,
      parts: filteredParts,
    };
  });

  return ai.convertToModelMessages(sanitisedMessages, options);
}
