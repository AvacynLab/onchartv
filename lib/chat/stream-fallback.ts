import { createUIMessageStream, JsonToSseTransformStream } from "ai";
import { differenceInSeconds } from "date-fns";

import type { ChatMessage } from "@/lib/types";

type GetMessagesByChatId = typeof import("@/lib/db/queries")["getMessagesByChatId"];

/**
 * Allow a generous polling window for the persistence layer to flush the
 * assistant response. Hermetic Playwright runs exercise the resume endpoint
 * immediately after sending a message, and Turbopack occasionally delays the
 * message persistence by a few seconds while modules warm up. Extending the
 * retry budget keeps the resume flow deterministic without affecting the
 * production Redis-backed implementation.
 */
const FALLBACK_LOOKUP_ATTEMPTS = 60;
const FALLBACK_LOOKUP_DELAY_MS = 100;
const MAX_EMPTY_MESSAGE_POLLS = 3;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Ensure assistant messages contain a stable text payload before they are
 * replayed through the redis-less resume fallback. Streaming responses often
 * persist a mix of transient delta events (`text-delta`, `appendMessage`) and
 * empty placeholders once the stream completes. The UI relies on the plain
 * `text` part to render deterministic content, so we rebuild that payload by
 * aggregating every textual fragment we can recover from the stored message.
 */
export function normaliseAssistantMessage<T extends { parts?: unknown }>(
  message: T
): T {
  if (!message || typeof message !== "object") {
    return message;
  }

  const parts = Array.isArray(message.parts) ? [...message.parts] : [];

  const hasRichTextPart = parts.some(
    (part) =>
      part &&
      typeof part === "object" &&
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim().length > 0
  );

  if (hasRichTextPart) {
    return message;
  }

  const aggregatedText = parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      if (typeof part.text === "string") {
        return part.text;
      }

      if (typeof (part as { delta?: unknown }).delta === "string") {
        return (part as { delta: string }).delta;
      }

      if (typeof (part as { message?: unknown }).message === "string") {
        return (part as { message: string }).message;
      }

      return "";
    })
    .join("")
    .trim();

  const messageContent =
    message &&
    typeof message === "object" &&
    "content" in (message as Record<string, unknown>)
      ? (message as { content?: unknown }).content
      : undefined;

  const fallbackText =
    aggregatedText.length > 0
      ? aggregatedText
      : typeof messageContent === "string"
        ? messageContent.trim()
        : "";

  if (!fallbackText) {
    return message;
  }

  const normalisedParts = parts.filter((part) => {
    if (!part || typeof part !== "object") {
      return true;
    }

    if (
      part.type === "text-delta" ||
      part.type === "appendMessage" ||
      part.type === "append-message"
    ) {
      return false;
    }

    if (
      part.type === "text" &&
      typeof (part as { text?: unknown }).text === "string" &&
      (part as { text: string }).text.trim().length === 0
    ) {
      return false;
    }

    return true;
  });

  const textPart: ChatMessage["parts"][number] = {
    type: "text",
    text: fallbackText,
  };

  const existingTextIndex = normalisedParts.findIndex(
    (part) => part && typeof part === "object" && part.type === "text"
  );

  const mergedParts = [...normalisedParts];

  if (existingTextIndex >= 0) {
    const existingPart = mergedParts[existingTextIndex];
    mergedParts[existingTextIndex] = {
      ...existingPart,
      ...textPart,
    };
  } else {
    mergedParts.push(textPart);
  }

  return {
    ...(message as object),
    parts: mergedParts,
  } as T;
}

async function resolveRecentAssistantMessage(
  chatId: string,
  resumeRequestedAt: Date,
  getMessages: GetMessagesByChatId
) {
  let consecutiveEmptyPolls = 0;
  for (let attempt = 0; attempt < FALLBACK_LOOKUP_ATTEMPTS; attempt += 1) {
    const messages = await getMessages({ id: chatId });
    if (messages.length === 0) {
      consecutiveEmptyPolls += 1;

      if (consecutiveEmptyPolls >= MAX_EMPTY_MESSAGE_POLLS) {
        // Give up after a handful of empty lookups so brand-new chats exit
        // quickly while still allowing in-flight assistant replies to persist.
        return null;
      }

      await delay(FALLBACK_LOOKUP_DELAY_MS);
      continue;
    }

    consecutiveEmptyPolls = 0;

    const mostRecentMessage = messages.at(-1);

    if (mostRecentMessage?.role === "assistant") {
      const messageCreatedAt = new Date(mostRecentMessage.createdAt);

      if (differenceInSeconds(resumeRequestedAt, messageCreatedAt) <= 15) {
        return normaliseAssistantMessage(mostRecentMessage);
      }

      return null;
    }

    await delay(FALLBACK_LOOKUP_DELAY_MS);
  }

  return null;
}

/**
 * Builds an empty UI message stream that resolves immediately.
 * The helper is exported to simplify unit verification of the fallback branch.
 */
export function createEmptyStream() {
  return createUIMessageStream<ChatMessage>({
    // biome-ignore lint/suspicious/noEmptyBlockStatements: "Needs to exist"
    execute: () => {},
  }).pipeThrough(new JsonToSseTransformStream());
}

async function resolveGetMessagesByChatId(
  override?: GetMessagesByChatId
): Promise<GetMessagesByChatId> {
  if (override) {
    return override;
  }

  const queries = await import("@/lib/db/queries");
  return queries.getMessagesByChatId;
}

/**
 * Generates a resumable stream response when Redis-backed streams are unavailable.
 *
 * The helper inspects the most recent assistant message and, if it was emitted
 * recently, synthesises an SSE payload that mirrors a standard appendMessage
 * event so the client can gracefully recover.
 */
export async function buildFallbackStreamResponse(
  chatId: string,
  resumeRequestedAt: Date,
  overrides?: {
    getMessagesByChatId?: GetMessagesByChatId;
  }
) {
  const emptyDataStream = createEmptyStream();

  const getMessages = await resolveGetMessagesByChatId(
    overrides?.getMessagesByChatId
  );

  const mostRecentMessage = await resolveRecentAssistantMessage(
    chatId,
    resumeRequestedAt,
    getMessages
  );

  if (!mostRecentMessage) {
    return new Response(emptyDataStream, { status: 200 });
  }

  const restoredStream = createUIMessageStream<ChatMessage>({
    execute: ({ writer }) => {
      writer.write({
        type: "data-appendMessage",
        data: JSON.stringify(mostRecentMessage),
        transient: true,
      });
    },
  });

  return new Response(
    restoredStream.pipeThrough(new JsonToSseTransformStream()),
    { status: 200 }
  );
}

export const __test = {
  FALLBACK_LOOKUP_ATTEMPTS,
  FALLBACK_LOOKUP_DELAY_MS,
};
