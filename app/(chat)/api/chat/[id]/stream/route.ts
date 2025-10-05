import { auth } from "@/app/(auth)/auth";
import { JsonToSseTransformStream } from "ai";

import { getChatById, getStreamIdsByChatId } from "@/lib/db/queries";
import type { Chat } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import {
  buildFallbackStreamResponse,
  createEmptyStream,
} from "@/lib/chat/stream-fallback";
import { getStreamContext } from "../../route";

/**
 * Allow a brief window for concurrent chat creation requests to persist the
 * record before the resume endpoint gives up. The e2e suite posts a message
 * and immediately opens the stream, so a short polling loop keeps the flow
 * deterministic without compromising on the eventual 404 for unknown chats.
 */
const CHAT_LOOKUP_ATTEMPTS = 5;
const CHAT_LOOKUP_DELAY_MS = 100;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  let chat: Chat | null = null;

  for (let attempt = 0; attempt < CHAT_LOOKUP_ATTEMPTS; attempt += 1) {
    try {
      chat = await getChatById({ id: chatId });
    } catch {
      if (attempt === CHAT_LOOKUP_ATTEMPTS - 1) {
        return new ChatSDKError("not_found:chat").toResponse();
      }
    }

    if (chat) {
      break;
    }

    await delay(CHAT_LOOKUP_DELAY_MS);
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
