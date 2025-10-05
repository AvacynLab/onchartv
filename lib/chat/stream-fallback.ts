import { createUIMessageStream, JsonToSseTransformStream } from "ai";
import { differenceInSeconds } from "date-fns";

import { getMessagesByChatId } from "@/lib/db/queries";
import type { ChatMessage } from "@/lib/types";

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

  const messages = await getMessagesByChatId({ id: chatId });
  const mostRecentMessage = messages.at(-1);

  if (!mostRecentMessage || mostRecentMessage.role !== "assistant") {
    return new Response(emptyDataStream, { status: 200 });
  }

  const messageCreatedAt = new Date(mostRecentMessage.createdAt);

  if (differenceInSeconds(resumeRequestedAt, messageCreatedAt) > 15) {
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
