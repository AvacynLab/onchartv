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

  /**
   * Inline edits frequently emit a fresh `input_text` fragment while still
   * carrying the previously persisted `text` payload. We determine the most
   * authoritative entry ahead of time so we can replace the first textual
   * fragment in the list with the refreshed value while preserving the order of
   * non-text attachments and tool references.
   */
  let bestText: {
    canonical: NonNullable<ChatMessage["parts"]>[number];
    priority: number;
    index: number;
  } | null = null;

  parts.forEach((part, index) => {
    if (part == null) {
      return;
    }

    const extractedText = extractTextFromMessagePart(part);
    if (extractedText == null) {
      return;
    }

    const canonicalPart = createCanonicalTextPart(part, extractedText);
    const priority = resolveTextPriority(part);

    if (
      !bestText ||
      priority > bestText.priority ||
      (priority === bestText.priority && index > bestText.index)
    ) {
      bestText = { canonical: canonicalPart, priority, index };
    }
  });

  if (!bestText) {
    return parts.filter((part): part is NonNullable<ChatMessage["parts"]>[number] => part != null);
  }

  // The canonical fragment is reused for the first textual slot so capture it
  // once and keep subsequent iterations focused on attachment ordering.
  const resolvedBestText = bestText;
  const canonicalTextPart = resolvedBestText.canonical;

  const normalised: ChatMessage["parts"] = [];
  let textInserted = false;

  for (const part of parts) {
    if (part == null) {
      continue;
    }

    const extractedText = extractTextFromMessagePart(part);

    if (extractedText == null) {
      normalised.push(part);
      continue;
    }

    if (!textInserted) {
      normalised.push(canonicalTextPart);
      textInserted = true;
    }
    // Skip any remaining textual fragments so only the canonical entry
    // persists in the array.
  }

  return normalised;
}

function resolveTextPriority(
  part: NonNullable<ChatMessage["parts"]>[number]
): number {
  if (typeof part === "object" && part !== null) {
    if (
      "input_text" in part &&
      typeof (part as { input_text?: unknown }).input_text === "string"
    ) {
      return 3;
    }

    if (
      "text" in part &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      return 2;
    }
  }

  // Legacy string fragments are still valid but have the lowest priority.
  return 1;
}
