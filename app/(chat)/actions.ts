"use server";

import { generateText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import type { VisibilityType } from "@/components/visibility-selector";
import { myProvider } from "@/lib/ai/providers";
import type { Attachment, ChatMessage } from "@/lib/types";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateMessagePartsById,
  updateChatVisiblityById,
} from "@/lib/db/queries";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const { text: title } = await generateText({
    model: myProvider.languageModel("title-model"),
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons`,
    prompt: JSON.stringify(message),
  });

  return title;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  if (!message) {
    return;
  }

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
    excludeMessageId: message.id,
  });
}

/**
 * Some persisted chat records include a legacy `content` payload alongside the
 * structured `parts`. The runtime `ChatMessage` type no longer exposes that
 * property, so we approximate the historical shapes to keep inline edit flows
 * compatible when they resurface older messages.
 */
type MessageContent =
  | string
  | Array<Record<string, unknown>>
  | Record<string, unknown>;

export async function updateMessageParts({
  id,
  parts,
  attachments,
  content,
}: {
  id: string;
  parts: ChatMessage["parts"];
  attachments?: Attachment[];
  content?: MessageContent;
}) {
  await updateMessagePartsById({ id, parts, attachments, content });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisiblityById({ chatId, visibility });
}
