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
import type { Attachment, ChatMessage } from "@/lib/types";
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

type NonTextPart = Exclude<
  ChatMessage["parts"][number],
  { type: "text" }
>;

type FilePart = Extract<ChatMessage["parts"][number], { type: "file" }>;

type MessageContentEntry =
  | string
  | ({ type: string } & Record<string, unknown>);

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

              const preservedNonTextParts = (message.parts ?? []).filter(
                (part): part is NonTextPart => part.type !== "text"
              );

              const updatedParts = [
                ...preservedNonTextParts,
                { type: "text", text: draftContent },
              ] as ChatMessage["parts"];

              const attachmentsForPersistence: Attachment[] = preservedNonTextParts
                .filter((part): part is FilePart => part.type === "file")
                .map((part) => {
                  const namedPart = part as {
                    name?: string;
                    filename?: string;
                    mediaType?: string;
                    contentType?: string;
                    url: string;
                  };

                  const derivedName =
                    typeof namedPart.name === "string" && namedPart.name.trim()
                      ? namedPart.name
                      : typeof namedPart.filename === "string" &&
                          namedPart.filename.trim()
                        ? namedPart.filename
                        : "attachment";

                  const mediaType =
                    (typeof namedPart.mediaType === "string" &&
                      namedPart.mediaType) ||
                    (typeof namedPart.contentType === "string" &&
                      namedPart.contentType) ||
                    "application/octet-stream";

                  return {
                    name: derivedName,
                    url: namedPart.url,
                    contentType: mediaType,
                  };
                });

              const updatedMessage: ChatMessage & {
                content?: MessageContentEntry[] | MessageContentEntry;
                attachments?: Attachment[];
              } = {
                ...message,
                parts: updatedParts,
                attachments: attachmentsForPersistence,
              };

              if ("content" in message) {
                const existingContent = (message as {
                  content?: MessageContentEntry[] | MessageContentEntry;
                }).content;

                if (typeof existingContent === "string") {
                  updatedMessage.content = draftContent;
                } else if (Array.isArray(existingContent)) {
                  const preservedContentEntries = existingContent.filter(
                    (entry) => {
                      if (entry == null) {
                        return false;
                      }

                      if (typeof entry === "string") {
                        return false;
                      }

                      if (
                        typeof entry === "object" &&
                        "type" in entry &&
                        entry.type === "text"
                      ) {
                        return false;
                      }

                      return true;
                    }
                  );

                  updatedMessage.content = [
                    ...preservedContentEntries,
                    { type: "text", text: draftContent },
                  ];
                }
              }

              await updateMessageParts({
                id: message.id,
                parts: updatedParts,
                attachments: attachmentsForPersistence,
              });

              await deleteTrailingMessages({
                id: message.id,
              });

              const serialisableMessage = (() => {
                try {
                  return structuredClone(updatedMessage);
                } catch (_error) {
                  return JSON.parse(JSON.stringify(updatedMessage));
                }
              })() as ChatMessage & {
                content?: MessageContentEntry[] | MessageContentEntry;
                attachments?: Attachment[];
              };

              serialisableMessage.attachments = attachmentsForPersistence;

              // Ensure the shared chat store reflects the edited prompt before
              // we trigger a new generation so the assistant sees the latest
              // text instead of the stale copy that originally produced the
              // response Playwright is about to replace.
              await new Promise<void>((resolve) => {
                setMessages((messages) => {
                  const nextMessages: ChatMessage[] = [];
                  let foundEditedMessage = false;

                  for (const candidate of messages) {
                    if (candidate.id === message.id) {
                      nextMessages.push(serialisableMessage);
                      foundEditedMessage = true;
                      break;
                    }

                    nextMessages.push(candidate);
                  }

                  resolve();

                  if (!foundEditedMessage) {
                    return messages;
                  }

                  return nextMessages;
                });
              });

              /**
               * Kick off a fresh generation so the assistant produces a new
               * response for the edited prompt. Await the promise before
               * emitting the Playwright signal to guarantee the streaming
               * watchers observe a completed transition.
               */
              submissionPromise = regenerate({
                messageId: message.id,
              });

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
