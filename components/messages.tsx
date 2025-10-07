import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { ArrowDownIcon } from "lucide-react";
import React, { memo, useEffect, useRef } from "react";
import { useMessages } from "@/hooks/use-messages";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { useDataStream } from "./data-stream-provider";
import { Conversation, ConversationContent } from "./elements/conversation";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";

type MessagesProps = {
  chatId: string;
  status: UseChatHelpers<ChatMessage>["status"];
  votes?: Vote[] | null;
  messages?: ChatMessage[] | null;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  isArtifactVisible: boolean;
  selectedModelId: string;
};

const isRenderableMessage = (value: ChatMessage | null | undefined): value is ChatMessage => {
  return (
    Boolean(value) &&
    typeof value?.id === "string" &&
    Array.isArray(value.parts)
  );
};

function PureMessages({
  chatId,
  status,
  votes,
  messages,
  setMessages,
  regenerate,
  isReadonly,
  selectedModelId,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
  } = useMessages({
    status,
  });

  /**
   * Normalise the inputs so downstream rendering logic can operate on plain
   * arrays. The hooks feed `null`/`undefined` until the first payload arrives
   * which is why we coerce with the nullish coalescing operator instead of
   * assuming array semantics.
   */
  const safeMessages = Array.isArray(messages) ? messages : messages ?? [];
  const safeVotes = Array.isArray(votes) ? votes : votes ?? [];

  /**
   * Track the previous message count and the viewport stickiness so we can
   * decide whether the UI should auto-scroll. The value is stored in a ref to
   * avoid triggering additional renders while still giving us the latest
   * information inside effects.
   */
  const previousMessageCountRef = useRef(safeMessages.length);
  const wasAtBottomRef = useRef(true);

  useDataStream();

  useEffect(() => {
    wasAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = safeMessages.length;

    if (safeMessages.length === 0) {
      return;
    }

    const hasNewMessage = safeMessages.length > previousCount;
    const shouldAutoScroll =
      hasNewMessage && (wasAtBottomRef.current || status === "submitted");

    if (!shouldAutoScroll) {
      return;
    }

    /**
     * Defer the actual scroll to the hook so the intent is centralised. The
     * hook performs the imperative `scrollTo` call on the next frame which
     * keeps the behaviour deterministic between the browser and the test
     * environment.
     */
    scrollToBottom("smooth");
  }, [safeMessages, scrollToBottom, status]);

  return (
    <div
      className="overscroll-behavior-contain -webkit-overflow-scrolling-touch relative flex-1 touch-pan-y overflow-y-scroll"
      ref={messagesContainerRef}
      style={{ overflowAnchor: "none" }}
    >
      <Conversation className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 md:gap-6">
        <ConversationContent className="flex flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          {safeMessages.length === 0 && <Greeting />}

          {safeMessages.map((message, index) => {
            if (!isRenderableMessage(message)) {
              console.warn("[Messages] message payload is malformed", message);
              return (
                <div
                  className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
                  data-testid="chat-message-fallback"
                  key={`message-fallback-${index}`}
                  role="status"
                >
                  Message indisponible : le contenu fourni est invalide.
                </div>
              );
            }

            const matchingVote = safeVotes.find(
              (vote) => vote.messageId === message.id
            );

            /**
             * Guard the artefact list because assistant responses sometimes
             * return `null` or omit the property entirely. We copy the message
             * object to avoid mutating the original reference consumed by the
             * memoiser.
             */
            const safeArtifacts = Array.isArray(message.artifacts)
              ? message.artifacts
              : message.artifacts ?? [];
            const normalisedMessage = {
              ...message,
              artifacts: safeArtifacts,
            } as ChatMessage;

            return (
              <PreviewMessage
                chatId={chatId}
                isLoading={
                  status === "streaming" && safeMessages.length - 1 === index
                }
                isReadonly={isReadonly}
                key={message.id}
                message={normalisedMessage}
                regenerate={regenerate}
                requiresScrollPadding={
                  hasSentMessage && index === safeMessages.length - 1
                }
                setMessages={setMessages}
                vote={matchingVote}
              />
            );
          })}

          {status === "submitted" &&
            safeMessages.length > 0 &&
            safeMessages.at(-1)?.role === "user" &&
            selectedModelId !== "chat-model-reasoning" && <ThinkingMessage />}

          <div
            className="min-h-[24px] min-w-[24px] shrink-0"
            ref={messagesEndRef}
          />
        </ConversationContent>
      </Conversation>

      {!isAtBottom && (
        <button
          aria-label="Scroll to bottom"
          className="-translate-x-1/2 absolute bottom-40 left-1/2 z-10 rounded-full border bg-background p-2 shadow-lg transition-colors hover:bg-muted"
          data-testid="scroll-to-bottom-button"
          onClick={() => scrollToBottom("smooth")}
          type="button"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.isArtifactVisible && nextProps.isArtifactVisible) {
    return true;
  }

  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.selectedModelId !== nextProps.selectedModelId) {
    return false;
  }
  const prevMessages = prevProps.messages ?? [];
  const nextMessages = nextProps.messages ?? [];
  if (prevMessages.length !== nextMessages.length) {
    return false;
  }
  if (!equal(prevMessages, nextMessages)) {
    return false;
  }
  const prevVotes = prevProps.votes ?? [];
  const nextVotes = nextProps.votes ?? [];
  if (!equal(prevVotes, nextVotes)) {
    return false;
  }

  return false;
});
