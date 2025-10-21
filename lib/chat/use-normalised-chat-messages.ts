import { useEffect } from "react";

import type { ChatMessage } from "@/lib/types";

import {
  prepareNormalisedMessageUpdate,
  type IdentifierPatch,
} from "./message-identifiers";

export type UseNormaliseChatMessagesOptions = {
  chatId: string;
  messages: ChatMessage[] | null | undefined;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onIdentifierPatches?: (patches: readonly IdentifierPatch[]) => void;
};

/**
 * React hook responsible for ensuring every streamed chat message exposes a
 * stable identifier. The upstream SDK occasionally omits `id` fields while the
 * assistant response is streaming; without this normalisation the UI would lose
 * track of existing bubbles which, in turn, prevents Playwright from locating
 * them reliably.
 *
 * The helper wraps `prepareNormalisedMessageUpdate` so the state setter always
 * receives a fresh array reference whenever a synthetic identifier is
 * generated. Callers can optionally react to the identifier patches (for
 * logging) once the state has been updated.
 */
export function useNormaliseChatMessages({
  chatId,
  messages,
  setMessages,
  onIdentifierPatches,
}: UseNormaliseChatMessagesOptions): void {
  useEffect(() => {
    if (!Array.isArray(messages) || messages.length === 0) {
      return;
    }

    const hasMessageMissingId = messages.some((message) => {
      if (!message || typeof message !== "object") {
        return false;
      }

      return !(
        typeof message.id === "string" && message.id.trim().length > 0
      );
    });

    if (!hasMessageMissingId) {
      return;
    }

    /**
     * Hold the identifier patches emitted while normalising the message
     * collection.  The array stays mutable because the downstream logging hook
     * expects a standard list, and retaining the union with `null` makes the
     * post-effect guard trivial.
     */
    let identifierPatches: IdentifierPatch[] | null = null;

    setMessages((currentMessages) => {
      const prepared = prepareNormalisedMessageUpdate({
        chatId,
        messages: currentMessages,
      });

      if (!prepared) {
        return currentMessages;
      }

      identifierPatches = prepared.patches;
      return prepared.messages;
    });

    const patchesToLog = identifierPatches;

    if (Array.isArray(patchesToLog) && patchesToLog.length > 0) {
      onIdentifierPatches?.(patchesToLog);
    }
  }, [chatId, messages, onIdentifierPatches, setMessages]);
}
