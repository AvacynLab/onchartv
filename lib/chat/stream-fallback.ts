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

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function resolveRecentAssistantMessage(
  chatId: string,
  resumeRequestedAt: Date,
  getMessages: GetMessagesByChatId
) {
  for (let attempt = 0; attempt < FALLBACK_LOOKUP_ATTEMPTS; attempt += 1) {
    const messages = await getMessages({ id: chatId });
    if (messages.length === 0) {
      // The chat has never received a reply, so there is nothing to replay and
      // no reason to keep polling. Returning early avoids a pointless wait in
      // resume flows triggered before the first assistant message is created.
      return null;
    }

    const mostRecentMessage = messages.at(-1);

    if (mostRecentMessage?.role === "assistant") {
      const messageCreatedAt = new Date(mostRecentMessage.createdAt);

      if (differenceInSeconds(resumeRequestedAt, messageCreatedAt) <= 15) {
        return mostRecentMessage;
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
