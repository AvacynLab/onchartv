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
/**
 * Allow the resume fallback to observe multiple empty polls (~2 seconds) before
 * assuming no assistant reply exists. This keeps brand-new chats responsive
 * while still giving the persistence layer enough time to flush streamed
 * messages during slower hermetic runs.
 */
const MAX_EMPTY_MESSAGE_POLLS = 20;

type DelayFn = (ms: number) => Promise<void>;

const delay: DelayFn = (ms: number) =>
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
/**
 * Recursively extract textual content from the variety of message shapes that
 * can be persisted by streamed assistant replies. The helper understands plain
 * strings, nested text payloads, delta fragments and appendMessage snapshots so
 * the resume fallback can rebuild a deterministic text part.
 */
function extractTextFragment(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractTextFragment(entry)).join("");
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.text === "string") {
      return record.text;
    }

    if (record.text) {
      const nested = extractTextFragment(record.text);
      if (nested) return nested;
    }

    if (typeof record.delta === "string") {
      return record.delta;
    }

    if (record.delta) {
      const nested = extractTextFragment(record.delta);
      if (nested) return nested;
    }

    if (typeof record.message === "string") {
      return record.message;
    }

    if (record.message) {
      const nested = extractTextFragment(record.message);
      if (nested) return nested;
    }

    if (typeof record.value === "string") {
      return record.value;
    }

    if (record.value) {
      const nested = extractTextFragment(record.value);
      if (nested) return nested;
    }

    if (typeof record.content === "string") {
      return record.content;
    }

    if (record.content) {
      const nested = extractTextFragment(record.content);
      if (nested) return nested;
    }
  }

  return "";
}

const collapseRepeatedSpaces = (value: string) => value.replace(/[ \t]{2,}/g, " ");

const RESUME_PLACEHOLDER_TEXT =
  "The assistant response is still processing. Please try again shortly.";

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
      typeof (part as { text?: unknown }).text === "string" &&
      (part as { text: string }).text.trim().length > 0
  );

  if (hasRichTextPart) {
    return message;
  }

  const aggregatedText = parts
    .map((part) => extractTextFragment(part))
    .join("")
    .trim();

  const messageContent = extractTextFragment(
    message && typeof message === "object"
      ? (message as { content?: unknown }).content
      : undefined
  );

  const rawFallbackText = aggregatedText.length > 0
    ? aggregatedText
    : messageContent;

  const resolvedText = (() => {
    const collapsed = collapseRepeatedSpaces(rawFallbackText).trim();
    return collapsed.length > 0 ? collapsed : RESUME_PLACEHOLDER_TEXT;
  })();

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
    text: resolvedText,
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
  getMessages: GetMessagesByChatId,
  sleep: DelayFn
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

      await sleep(FALLBACK_LOOKUP_DELAY_MS);
      continue;
    }

    consecutiveEmptyPolls = 0;

    const mostRecentMessage = messages.at(-1);

    if (mostRecentMessage?.role === "assistant") {
      const messageCreatedAt = new Date(mostRecentMessage.createdAt);

      if (differenceInSeconds(resumeRequestedAt, messageCreatedAt) <= 15) {
        const normalised = normaliseAssistantMessage(mostRecentMessage);

        const parts = Array.isArray((normalised as { parts?: unknown }).parts)
          ? ((normalised as { parts: Array<{ type?: string; text?: unknown }> }).parts)
          : [];

        const textPart = parts.find(
          (part) => part && part.type === "text"
        ) as { text?: unknown } | undefined;

        const textContent =
          typeof textPart?.text === "string"
            ? textPart.text.trim()
            : typeof textPart?.text === "object"
              ? extractTextFragment(textPart.text).trim()
              : "";

        if (!textContent) {
          // The assistant message has been persisted but its textual content
          // has not yet been finalised. Keep polling so the resume endpoint
          // replays a meaningful payload instead of returning an empty chunk.
          await sleep(FALLBACK_LOOKUP_DELAY_MS);
          continue;
        }

        return normalised;
      }

      return null;
    }

    await sleep(FALLBACK_LOOKUP_DELAY_MS);
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
    sleep?: DelayFn;
  }
) {
  const getMessages = await resolveGetMessagesByChatId(
    overrides?.getMessagesByChatId
  );

  const sleep = overrides?.sleep ?? delay;

  const mostRecentMessage = await resolveRecentAssistantMessage(
    chatId,
    resumeRequestedAt,
    getMessages,
    sleep
  );

  if (!mostRecentMessage) {
    /**
     * Redis stores return an empty body once a stream has completely finished.
     * Mirror that behaviour so callers relying on the legacy contract (e.g. the
     * `/api/chat` resume tests) continue to receive an empty payload rather than
     * an SSE terminator.
     */
    return new Response("", { status: 200 });
  }

  const encoder = new TextEncoder();
  const restoredStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const event = {
        type: "data-appendMessage" as const,
        data: JSON.stringify(mostRecentMessage),
        transient: true,
      };

      /**
       * Manually serialise the append event so the fallback mirrors the
       * structure emitted by the Redis-backed implementation. This keeps the
       * resume endpoint compatible with the Playwright route tests and avoids
       * pulling in the heavier `createUIMessageStream` pipeline just to flush a
       * single payload.
       */
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(restoredStream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const __test = {
  FALLBACK_LOOKUP_ATTEMPTS,
  FALLBACK_LOOKUP_DELAY_MS,
};
