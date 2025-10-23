"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { deleteTrailingMessages, updateMessageParts } from "@/app/(chat)/actions";
import { buildMessageTextSignature } from "@/lib/ai/messages/signature";
import type { Attachment, ChatMessage, MessageMetadata } from "@/lib/types";
import { messageMetadataSchema } from "@/lib/types";
import { cn, getTextFromMessage } from "@/lib/utils";
import { isAutomationRuntime } from "./utils/automation";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { toast } from "./toast";

type MessageWithAttachments = ChatMessage & {
  attachments?: Attachment[];
};

export type MessageEditorProps = {
  message: MessageWithAttachments;
  setMode: Dispatch<SetStateAction<"view" | "edit">>;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
};

export function MessageEditor({
  message,
  setMode,
  setMessages,
  regenerate,
}: MessageEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [draftContent, setDraftContent] = useState<string>(
    getTextFromMessage(message)
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftContent(event.target.value);
    adjustHeight();
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <Textarea
        className="w-full resize-none overflow-hidden rounded-xl bg-transparent text-base! outline-hidden"
        data-testid="message-editor"
        onChange={handleInput}
        ref={textareaRef}
        value={draftContent}
      />

      <div className="flex flex-row justify-end gap-2">
        <Button
          className="h-fit px-3 py-2"
          onClick={() => {
            setMode("view");
          }}
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          className={cn("h-fit px-3 py-2", { invisible: isSubmitting })}
          data-testid="message-editor-send-button"
          disabled={isSubmitting}
          onClick={async () => {
            const trimmedDraft = draftContent.trim();

            // Guard against accidental submissions when the user clears the
            // textarea entirely while editing. Sending an empty prompt would
            // lead to confusing assistant responses.
            if (trimmedDraft.length === 0) {
              toast({
                type: "error",
                description: "Please enter a message before resubmitting.",
              });
              return;
            }

            emitPlaywrightSignal("submit");
            setIsSubmitting(true);
            let switchedToViewMode = false;
            let regenerationPromise: Promise<unknown> | undefined;

            try {
              const removalCutoffIso = new Date().toISOString();
              await deleteTrailingMessages({
                id: message.id,
              });

              const updatedParts = rebuildMessageParts(message, trimmedDraft);
              const updatedAttachments = cloneAttachments(message);

              const signature = buildMessageTextSignature(updatedParts);

              const rawMetadata =
                typeof message.metadata === "object" && message.metadata !== null
                  ? message.metadata
                  : {};

              const metadataCandidate = {
                ...rawMetadata,
                createdAt:
                  typeof (rawMetadata as { createdAt?: unknown }).createdAt === "string"
                    ? (rawMetadata as { createdAt: string }).createdAt
                    : new Date().toISOString(),
              };

              const metadataResult = messageMetadataSchema.safeParse(metadataCandidate);

              const updatedMetadata: MessageMetadata = metadataResult.success
                ? {
                    ...metadataResult.data,
                    clientTextSignature: signature,
                  }
                : {
                    createdAt: new Date().toISOString(),
                    clientTextSignature: signature,
                  };

              const updatedMessage: MessageWithAttachments = {
                ...message,
                parts: updatedParts,
                attachments: updatedAttachments,
                metadata: updatedMetadata,
              };
              await updateMessageParts({
                id: message.id,
                parts: updatedParts,
                attachments: updatedAttachments,
              });

              setMessages((messages) => {
                const index = messages.findIndex((current) => current.id === message.id);

                if (index === -1) {
                  return messages;
                }

                const leadingMessages = messages.slice(0, index);
                const trailingMessages = messages.slice(index + 1);

                /**
                 * Preserve any trailing messages that were appended after the edit
                 * sequence began (for example, when the provider streams a fresh
                 * assistant reply before the reducer runs). Comparing the
                 * `createdAt` metadata against the cutoff keeps newly generated
                 * responses intact while still pruning the stale assistant reply
                 * that belongs to the previous prompt.
                 */
                const preservedTrailing = trailingMessages.filter((trailing) => {
                  const createdAt = extractCreatedAt(trailing);

                  if (!createdAt) {
                    return false;
                  }

                  return createdAt > removalCutoffIso;
                });

                /**
                 * Drop any trailing messages so the UI mirrors the database
                 * state after `deleteTrailingMessages` removes stale assistant
                 * responses. Keeping only the edited user prompt ensures the
                 * upcoming regeneration starts from a clean slate. Newer
                 * trailing entries (for example already-streamed assistant
                 * replies) are re-appended so concurrent updates are not lost.
                 */
                return [...leadingMessages, updatedMessage, ...preservedTrailing];
              });

              /**
               * Start the regeneration before collapsing the editor so the
               * chat helpers capture the freshly edited prompt. Once the
               * request is inflight we immediately swap back to the standard
               * view mode so the inline controls disappear without waiting for
               * the network roundtrip, matching the behaviour Playwright
               * expects during the edit flow.
               */
              regenerationPromise = regenerate({
                messageId: message.id,
                body: { message: updatedMessage },
              });

              emitPlaywrightSignal("sent");

              setMode("view");
              switchedToViewMode = true;

              await regenerationPromise;
            } catch (error) {
              emitPlaywrightSignal("error");
              console.error("Failed to resubmit edited message", error);

              toast({
                type: "error",
                description: "We couldn't resend your edit. Please try again.",
              });

              // Restore edit mode so the user can make further adjustments if
              // the server rejects the request.
              if (switchedToViewMode) {
                setMode("edit");
              }
            } finally {
              setIsSubmitting(false);
            }
          }}
          variant="default"
        >
          {isSubmitting ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}

function cloneAttachments(message: MessageWithAttachments): Attachment[] {
  if (Array.isArray(message.attachments)) {
    /**
     * Perform a shallow copy so mutations do not leak back into the existing
     * React state. Attachments only contain primitives, therefore a shallow
     * spread keeps the helper inexpensive while remaining safe.
     */
    return message.attachments.map((attachment) => ({ ...attachment }));
  }

  return [];
}

function rebuildMessageParts(
  originalMessage: ChatMessage,
  nextText: string
): ChatMessage["parts"] {
  const existingParts = Array.isArray(originalMessage.parts)
    ? originalMessage.parts
    : [];

  /**
   * Replace the first textual fragment (either the standard `text` part or the
   * AI SDK's `input_text` variant) with the freshly edited prompt while
   * discarding any additional text fragments that may linger from previous
   * submissions. This guarantees the server receives a single authoritative
   * prompt and prevents stale copies of the original text from skewing the
   * signature comparison logic.
   */
  const updatedParts: ChatMessage["parts"] = [];
  let textFragmentReplaced = false;

  for (const part of existingParts) {
    if (typeof part === "string") {
      /**
       * Legacy payloads persisted prior to the parts migration can surface raw
       * strings instead of structured `text` fragments. When editing such
       * messages we replace the first occurrence with the freshly edited
       * prompt and drop the legacy value to avoid replaying the stale text
       * alongside the updated content.
       */
      if (!textFragmentReplaced) {
        updatedParts.push({ type: "text", text: nextText });
        textFragmentReplaced = true;
      }

      continue;
    }

    /**
     * The AI SDK emits both `text` parts (with a `type` discriminator) and
     * legacy fragments that surface the edited prompt through an
     * `input_text` property without an accompanying `type`. We branch on both
     * shapes while keeping the guards type-safe for the UIMessagePart union.
     */
    if (part?.type === "text") {
      if (!textFragmentReplaced) {
        updatedParts.push({ ...part, text: nextText });
        textFragmentReplaced = true;
      }

      continue;
    }

    const isObjectPart = typeof part === "object" && part !== null;

    const hasExplicitText =
      isObjectPart &&
      "text" in (part as Record<string, unknown>) &&
      typeof (part as { text?: unknown }).text === "string";

    if (hasExplicitText) {
      if (!textFragmentReplaced) {
        updatedParts.push({ type: "text", text: nextText });
        textFragmentReplaced = true;
      }

      continue;
    }

    const hasInputText =
      isObjectPart &&
      "input_text" in part &&
      typeof (part as { input_text?: unknown }).input_text === "string";

    if (hasInputText) {
      if (!textFragmentReplaced) {
        /**
         * The discriminated union exposed by the AI SDK does not formally
         * define the legacy `input_text` fragment, therefore we clone the
         * original part as a generic record and cast it back to a
         * UIMessagePart after injecting the edited payload.
         */
        const updatedInputTextPart = {
          ...(part as Record<string, unknown>),
          input_text: nextText,
        } as Record<string, unknown>;

        updatedParts.push(
          updatedInputTextPart as unknown as ChatMessage["parts"][number]
        );
        textFragmentReplaced = true;
      }

      continue;
    }

    updatedParts.push(part);
  }

  if (!textFragmentReplaced) {
    updatedParts.push({ type: "text", text: nextText });
  }

  return updatedParts;
}

function extractCreatedAt(message: ChatMessage): string | null {
  if (typeof message.metadata !== "object" || message.metadata === null) {
    return null;
  }

  const candidate = (message.metadata as { createdAt?: unknown }).createdAt;

  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

function emitPlaywrightSignal(phase: "submit" | "sent" | "error") {
  if (typeof window === "undefined") {
    return;
  }

  const globalWindow = window as Window & {
    __PLAYWRIGHT_CHAT_SIGNALS__?: Array<{ phase: string; timestamp: number }>;
  };

  if (!Array.isArray(globalWindow.__PLAYWRIGHT_CHAT_SIGNALS__)) {
    globalWindow.__PLAYWRIGHT_CHAT_SIGNALS__ = [];
  }

  globalWindow.__PLAYWRIGHT_CHAT_SIGNALS__!.push({
    phase,
    timestamp: performance.now(),
  });

  if (!isAutomationRuntime()) {
    const maxSignals = 5;
    const buffer = globalWindow.__PLAYWRIGHT_CHAT_SIGNALS__!;
    if (buffer.length > maxSignals) {
      buffer.splice(0, buffer.length - maxSignals);
    }
  }
}
