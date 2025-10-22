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
            return {
              type: "text" as const,
              text,
            };
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
          ? normaliseUserTextFragments(filteredParts)
          : filteredParts,
    } as typeof message;
  });

  return ai.convertToModelMessages(sanitisedMessages, options);
}

/**
 * Collapse multiple textual fragments into a single authoritative entry for
 * user prompts. Inline edit flows occasionally retain the previous question as
 * an earlier fragment (string, `text`, or legacy `input_text`).
 *
 * Keeping only the freshest fragment avoids replaying stale prompts while
 * preserving the original order of non-text parts (attachments, tool results,
 * etc.).
 */
function normaliseUserTextFragments(
  parts: ChatMessage["parts"]
): ChatMessage["parts"] {
  if (!Array.isArray(parts) || parts.length === 0) {
    return parts;
  }

  const normalisedParts: ChatMessage["parts"] = [];
  let textIndex: number | null = null;

  for (const part of parts) {
    if (part == null) {
      continue;
    }

    const nextText = extractTextFromFragment(part);

    if (nextText == null) {
      normalisedParts.push(part);
      continue;
    }

    const normalisedTextPart = createTextPart(part, nextText);

    if (textIndex === null) {
      textIndex = normalisedParts.length;
      normalisedParts.push(normalisedTextPart);
    } else {
      normalisedParts[textIndex] = normalisedTextPart;
    }
  }

  return normalisedParts;
}

function extractTextFromFragment(
  part: NonNullable<ChatMessage["parts"]>[number]
): string | null {
  /**
   * The SDK typings guarantee structured parts, yet legacy cached payloads may
   * still surface raw strings. Casting through `unknown` lets us safely apply
   * runtime guards without fighting the stricter compile-time shape.
   */
  const candidate = part as unknown;

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }

  if (
    "text" in (candidate as Record<string, unknown>) &&
    typeof (candidate as { text?: unknown }).text === "string"
  ) {
    const text = (candidate as { text: string }).text;
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (
    "input_text" in (candidate as Record<string, unknown>) &&
    typeof (candidate as { input_text?: unknown }).input_text === "string"
  ) {
    const text = (candidate as { input_text: string }).input_text;
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

/**
 * Build a canonical text fragment while preserving any ancillary properties
 * present on the original part (for example annotations emitted by the SDK).
 */
function createTextPart(
  source: NonNullable<ChatMessage["parts"]>[number],
  text: string
): NonNullable<ChatMessage["parts"]>[number] {
  if (typeof source === "object" && source !== null) {
    if ("text" in source && typeof (source as { text?: unknown }).text === "string") {
      return {
        ...(source as Record<string, unknown>),
        type: "text",
        text,
      } as NonNullable<ChatMessage["parts"]>[number];
    }

    if (
      "input_text" in source &&
      typeof (source as { input_text?: unknown }).input_text === "string"
    ) {
      return {
        type: "text", // ensure downstream helpers receive a standard text fragment
        text,
      } as NonNullable<ChatMessage["parts"]>[number];
    }
  }

  return { type: "text", text } as NonNullable<ChatMessage["parts"]>[number];
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
