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
import { deleteTrailingMessages } from "@/app/(chat)/actions";
import type { ChatMessage } from "@/lib/types";
import { cn, getTextFromMessage } from "@/lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { toast } from "./toast";

export type MessageEditorProps = {
  message: ChatMessage;
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
            // Guard against accidental submissions when the user clears the
            // textarea entirely while editing. Sending an empty prompt would
            // lead to confusing assistant responses.
            if (!draftContent.trim()) {
              toast({
                type: "error",
                description: "Please enter a message before resubmitting.",
              });
              return;
            }

            setIsSubmitting(true);
            let switchedToViewMode = false;
            let regenerationPromise: Promise<unknown> | undefined;

            try {
              await deleteTrailingMessages({
                id: message.id,
              });

              setMessages((messages) => {
                const index = messages.findIndex((m) => m.id === message.id);

                if (index !== -1) {
                  const updatedMessage: ChatMessage = {
                    ...message,
                    parts: [{ type: "text", text: draftContent }],
                  };

                  return [...messages.slice(0, index), updatedMessage];
                }

                return messages;
              });

              /**
               * Start the regeneration before collapsing the editor so the
               * chat helpers capture the freshly edited prompt. Once the
               * request is inflight we immediately swap back to the standard
               * view mode so the inline controls disappear without waiting for
               * the network roundtrip, matching the behaviour Playwright
               * expects during the edit flow.
               */
              regenerationPromise = regenerate();

              setMode("view");
              switchedToViewMode = true;

              await regenerationPromise;
            } catch (error) {
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
