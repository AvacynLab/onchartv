import { createUIMessageStream, JsonToSseTransformStream } from "ai";
import { differenceInSeconds } from "date-fns";

import { getMessagesByChatId } from "@/lib/db/queries";
import type { ChatMessage } from "@/lib/types";

const FALLBACK_LOOKUP_ATTEMPTS = 20;
const FALLBACK_LOOKUP_DELAY_MS = 100;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function resolveRecentAssistantMessage(
  chatId: string,
  resumeRequestedAt: Date
) {
  for (let attempt = 0; attempt < FALLBACK_LOOKUP_ATTEMPTS; attempt += 1) {
    const messages = await getMessagesByChatId({ id: chatId });
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

/**
 * Generates a resumable stream response when Redis-backed streams are unavailable.
 *
 * The helper inspects the most recent assistant message and, if it was emitted
 * recently, synthesises an SSE payload that mirrors a standard appendMessage
 * event so the client can gracefully recover.
 */
export async function buildFallbackStreamResponse(
  chatId: string,
  resumeRequestedAt: Date
) {
  const emptyDataStream = createEmptyStream();

  const mostRecentMessage = await resolveRecentAssistantMessage(
    chatId,
    resumeRequestedAt
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
