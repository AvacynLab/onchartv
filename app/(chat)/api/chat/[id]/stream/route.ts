import { createUIMessageStream, JsonToSseTransformStream } from "ai";
import { differenceInSeconds } from "date-fns";
import { auth } from "@/app/(auth)/auth";
import {
  getChatById,
  getMessagesByChatId,
  getStreamIdsByChatId,
} from "@/lib/db/queries";
import type { Chat } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { getStreamContext } from "../../route";

/**
 * Builds an empty UI message stream that resolves immediately.
 * The helper is exported to simplify unit verification of the fallback branch.
 */
export function createEmptyStream() {
  return createUIMessageStream<ChatMessage>({
    // biome-ignore lint/suspicious/noEmptyBlockStatements: "Needs to exist"
    execute: () => {},
  });
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

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: chatId } = await params;

  const streamContext = getStreamContext();
  const resumeRequestedAt = new Date();

  if (!chatId) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  if (session.user.type !== "regular") {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  let chat: Chat | null;

  try {
    chat = await getChatById({ id: chatId });
  } catch {
    return new ChatSDKError("not_found:chat").toResponse();
  }

  if (!chat) {
    return new ChatSDKError("not_found:chat").toResponse();
  }

  if (chat.visibility === "private" && chat.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  if (!streamContext) {
    return buildFallbackStreamResponse(chatId, resumeRequestedAt);
  }

  const streamIds = await getStreamIdsByChatId({ chatId });

  if (!streamIds.length) {
    return buildFallbackStreamResponse(chatId, resumeRequestedAt);
  }

  const recentStreamId = streamIds.at(-1);

  if (!recentStreamId) {
    return buildFallbackStreamResponse(chatId, resumeRequestedAt);
  }

  const stream = await streamContext.resumableStream(recentStreamId, () =>
    createEmptyStream().pipeThrough(new JsonToSseTransformStream())
  );

  /*
   * For when the generation is streaming during SSR
   * but the resumable stream has concluded at this point.
   */
  if (!stream) {
    return buildFallbackStreamResponse(chatId, resumeRequestedAt);
  }

  return new Response(stream, { status: 200 });
}
