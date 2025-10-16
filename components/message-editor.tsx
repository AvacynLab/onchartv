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
import type { Attachment, ChatMessage } from "@/lib/types";
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
              await deleteTrailingMessages({
                id: message.id,
              });

              const updatedParts = rebuildMessageParts(message, trimmedDraft);
              const updatedAttachments = cloneAttachments(message);

              const updatedMetadata =
                typeof message.metadata === "object" && message.metadata !== null
                  ? { ...message.metadata }
                  : {};

              const updatedMessage: MessageWithAttachments = {
                ...message,
                parts: updatedParts,
                attachments: updatedAttachments,
                metadata: {
                  ...updatedMetadata,
                  clientTextSignature: buildMessageTextSignature(updatedParts),
                },
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

                const existingMessage = messages[index];
                return [...messages.slice(0, index), updatedMessage];
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

  let textFragmentReplaced = false;

  const updatedParts = existingParts.map((part) => {
    if (part?.type === "text" && !textFragmentReplaced) {
      textFragmentReplaced = true;
      return { ...part, text: nextText };
    }

    return part;
  });

  if (!textFragmentReplaced) {
    updatedParts.push({ type: "text", text: nextText });
  }

  return updatedParts;
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
