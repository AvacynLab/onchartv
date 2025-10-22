import type { ChatMessage } from "@/lib/types";

/**
 * Extract the visible text from a message fragment. The helper accepts the
 * loose union that the AI SDK surfaces so legacy payloads (plain strings or
 * `input_text` entries) are normalised alongside the modern `text` parts.
 */
export function extractTextFromMessagePart(
  part: NonNullable<ChatMessage["parts"]>[number]
): string | null {
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
 * Build a canonical text fragment while preserving ancillary metadata the AI
 * SDK may include on the original part. Normalising every textual fragment to
 * the standard `text` shape keeps downstream helpers agnostic of the incoming
 * representation while documenting any assumptions in one place.
 */
export function createCanonicalTextPart(
  source: NonNullable<ChatMessage["parts"]>[number],
  text: string
): NonNullable<ChatMessage["parts"]>[number] {
  if (typeof source === "object" && source !== null) {
    if (
      "text" in source &&
      typeof (source as { text?: unknown }).text === "string"
    ) {
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
        type: "text",
        text,
      } as NonNullable<ChatMessage["parts"]>[number];
    }
  }

  return { type: "text", text } as NonNullable<ChatMessage["parts"]>[number];
}

/**
 * Collapse multiple textual fragments into a single authoritative entry for
 * user prompts. Inline edit flows may retain the previous question alongside
 * the freshly edited prompt; keeping only the latest non-empty text ensures the
 * server and mock providers stream the correct message while preserving the
 * relative order of any non-text fragments (attachments, tool references, …).
 */
export function normaliseUserMessageParts(
  parts: ChatMessage["parts"]
): ChatMessage["parts"] {
  if (!Array.isArray(parts) || parts.length === 0) {
    return [];
  }

  const normalised: ChatMessage["parts"] = [];
  let textIndex: number | null = null;

  for (const part of parts) {
    if (part == null) {
      continue;
    }

    const extractedText = extractTextFromMessagePart(part);

    if (extractedText == null) {
      normalised.push(part);
      continue;
    }

    const canonicalPart = createCanonicalTextPart(part, extractedText);

    if (textIndex === null) {
      textIndex = normalised.length;
      normalised.push(canonicalPart);
    } else {
      normalised[textIndex] = canonicalPart;
    }
  }

  return normalised;
}
