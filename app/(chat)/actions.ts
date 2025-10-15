"use server";

import { generateText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import type { VisibilityType } from "@/components/visibility-selector";
import { myProvider } from "@/lib/ai/providers";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
  updateMessagePartsById,
} from "@/lib/db/queries";
import type { Attachment, ChatMessage } from "@/lib/types";

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
    /**
     * Ensure regenerated responses do not reuse the previous assistant output
     * even when both messages share the same millisecond-level timestamp. The
     * optional guard keeps the edited user prompt intact while pruning any
     * sibling entries created during the original generation cycle.
     */
    excludeMessageId: message.id,
  });
}

/**
 * Persist the edited message parts and attachments. Legacy `content` payloads
 * are reconstructed client-side from the parts array, so they are deliberately
 * excluded from this write path.
 */
export async function updateMessageParts({
  id,
  parts,
  attachments,
}: {
  id: string;
  parts: ChatMessage["parts"];
  attachments: Attachment[];
}) {
  await updateMessagePartsById({ id, parts, attachments });
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
