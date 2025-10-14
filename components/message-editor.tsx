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
import { isAutomationRuntime } from "./utils/automation";

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

  /**
   * Playwright relies on an in-page signal buffer to detect when inline edits
   * kick off a fresh generation. Re-using the same emitter as the composer
   * keeps both flows observable without forcing the test harness to fall back
   * exclusively on DOM heuristics (which would be far more brittle).
   */
  const emitPlaywrightSignal = useCallback((phase: string) => {
    if (typeof window === "undefined") {
      return;
    }

    const globalWindow = window as Window & {
      __PLAYWRIGHT_CHAT_SIGNALS__?: Array<{
        phase: string;
        timestamp: number;
      }>;
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
      const signalBuffer = globalWindow.__PLAYWRIGHT_CHAT_SIGNALS__!;
      if (signalBuffer.length > maxSignals) {
        signalBuffer.splice(0, signalBuffer.length - maxSignals);
      }
    }
  }, []);

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
            let submissionPromise: Promise<unknown> | undefined;

            try {
              emitPlaywrightSignal("submit");

              await deleteTrailingMessages({
                id: message.id,
              });

              /**
               * Update the local message store immediately so the edited
               * prompt appears in the transcript before the regeneration
               * finishes. This mirrors the behaviour of the original inline
               * editor while keeping attachments and metadata intact.
               */
              type FilePart = Extract<
                ChatMessage["parts"][number],
                { type: "file" }
              >;

              const preservedAttachments = message.parts.filter(
                (part): part is FilePart => part.type === "file"
              );

              setMessages((messages) => {
                const index = messages.findIndex((candidate) => {
                  return candidate.id === message.id;
                });

                if (index === -1) {
                  return messages;
                }

                const updatedMessage: ChatMessage = {
                  ...message,
                  parts: [
                    ...preservedAttachments,
                    { type: "text", text: draftContent },
                  ],
                };

                return [...messages.slice(0, index), updatedMessage];
              });

              /**
               * Kick off a fresh generation so the assistant produces a new
               * response for the edited prompt. Await the promise before
               * emitting the Playwright signal to guarantee the streaming
               * watchers observe a completed transition.
               */
              submissionPromise = regenerate();

              setMode("view");
              switchedToViewMode = true;

              await submissionPromise;
              emitPlaywrightSignal("sent");
            } catch (error) {
              console.error("Failed to resubmit edited message", error);

              toast({
                type: "error",
                description: "We couldn't resend your edit. Please try again.",
              });

              emitPlaywrightSignal("error");

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
