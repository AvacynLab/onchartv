import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { ArrowDownIcon } from "lucide-react";
import React, { Fragment, memo, useEffect, useRef } from "react";
import { useMessages } from "@/hooks/use-messages";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { useDataStream } from "./data-stream-provider";
import { Conversation, ConversationContent } from "./elements/conversation";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";
import {
  financeArtifactSchema,
  type FinanceArtifact,
} from "@/lib/finance/types";
import * as featureFlags from "@/lib/feature-flags";
import { logWarning } from "@/lib/logging";

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
  financeFeatureEnabledOverride?: boolean;
};

const isRenderableMessage = (value: ChatMessage | null | undefined): value is ChatMessage => {
  return (
    Boolean(value) &&
    typeof value?.id === "string" &&
    Array.isArray(value.parts)
  );
};

type InvalidArtifactLog = {
  artifactIndex: number;
  messageId: string;
  issues: string[];
  type?: string;
};

/**
 * Attempt to parse the provided artefact through the finance discriminated
 * union. Returning `null` keeps the caller in charge of surfacing fallbacks
 * without throwing, which is critical for end-user resilience.
 */
const parseFinanceArtifact = (
  artifact: unknown,
  artifactIndex: number,
  messageId: string,
  invalidArtifacts: InvalidArtifactLog[],
  typeHint?: string
): FinanceArtifact | null => {
  const logInvalid = (details: {
    issues: string[];
    type?: string;
  }) => {
    invalidArtifacts.push({
      artifactIndex,
      issues: details.issues,
      messageId,
      type: details.type,
    });
    logWarning("chat:messages", "[Messages] artifact payload is malformed and will be ignored", {
      artifact,
      artifactIndex,
      issues: details.issues,
      messageId,
      type: details.type,
    });
  };

  if (!artifact || typeof artifact !== "object") {
    logInvalid({ issues: ["artifact is not an object"], type: typeHint });
    return null;
  }

  const candidate = artifact as { type?: unknown };

  if (typeof candidate.type !== "string") {
    logInvalid({ issues: ["artifact.type must be a string"], type: typeHint });
    return null;
  }

  const parsed = financeArtifactSchema.safeParse(artifact);

  if (!parsed.success) {
    logInvalid({
      issues: parsed.error.issues.map((issue) => issue.message),
      type: candidate.type,
    });
    return null;
  }

  return parsed.data;
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
  financeFeatureEnabledOverride,
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
   * Evaluate the finance flag once per render. Tests can inject
   * `financeFeatureEnabledOverride` to force the disabled branch without
   * mutating global process state.
   */
  const financeFeatureEnabled =
    typeof financeFeatureEnabledOverride === "boolean"
      ? financeFeatureEnabledOverride
      : featureFlags.isFinanceFeatureEnabledClient();

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
              logWarning("chat:messages", "[Messages] message payload is malformed", {
                message,
              });
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
             * return `null` or omit the property entirely. We cast through
             * `unknown` to inspect the optional field without fighting the
             * stricter `ChatMessage` typing exported by the AI SDK, then copy
             * the value into the array shape expected by the preview renderer
             * so downstream consumers stay immutable.
             */
            const rawArtifacts = (message as unknown as { artifacts?: unknown }).artifacts;

            /**
             * Build a unified list of artefact candidates originating either from
             * the legacy `message.artifacts` array (streaming responses) or from
             * persisted UI data parts (historical conversations). Keeping both
             * sources ensures that previously stored chats continue to render
             * finance payloads after we migrated the database representation to a
             * discriminated union.
             */
            const artifactCandidates: Array<{
              value: unknown;
              typeHint?: string;
            }> = [];

            if (Array.isArray(rawArtifacts)) {
              for (const candidate of rawArtifacts) {
                const candidateType =
                  typeof (candidate as { type?: unknown })?.type === "string"
                    ? ((candidate as { type: string }).type as string)
                    : undefined;
                artifactCandidates.push({ value: candidate, typeHint: candidateType });
              }
            }

            if (Array.isArray(message.parts)) {
              for (const part of message.parts) {
                if (
                  !part ||
                  typeof part !== "object" ||
                  !("type" in part) ||
                  typeof part.type !== "string" ||
                  !part.type.startsWith("data-finance")
                ) {
                  continue;
                }

                const dataCarrier = part as { data?: unknown };
                const nested = dataCarrier.data;
                const nestedType =
                  typeof (nested as { type?: unknown })?.type === "string"
                    ? ((nested as { type: string }).type as string)
                    : undefined;

                artifactCandidates.push({ value: nested, typeHint: nestedType });
              }
            }

            const invalidArtifacts: InvalidArtifactLog[] = [];
            const sanitizedArtifacts: FinanceArtifact[] = financeFeatureEnabled
              ? artifactCandidates.reduce<FinanceArtifact[]>((acc, candidate, artifactIndex) => {
                  const parsed = parseFinanceArtifact(
                    candidate.value,
                    artifactIndex,
                    message.id,
                    invalidArtifacts,
                    candidate.typeHint
                  );

                  if (parsed) {
                    acc.push(parsed);
                  }

                  return acc;
                }, [])
              : [];

            if (!financeFeatureEnabled && artifactCandidates.length > 0) {
              /**
               * When finance experiences are disabled the UI must stay silent
               * about any related artefacts. Swallowing the payload keeps the
               * assistant copy visible while mirroring the server-side flag
               * behaviour (APIs emit `403` when the feature is disabled).
               */
              logWarning("chat:messages", "[Messages] finance artefact hidden by feature flag", {
                artifactCount: artifactCandidates.length,
                messageId: message.id,
              });
            }

            const normalisedMessage = {
              ...message,
              artifacts: sanitizedArtifacts,
            } as ChatMessage;

            const invalidCount = financeFeatureEnabled ? invalidArtifacts.length : 0;

            return (
              <Fragment key={message.id}>
                <PreviewMessage
                  chatId={chatId}
                  isLoading={
                    status === "streaming" && safeMessages.length - 1 === index
                  }
                  isReadonly={isReadonly}
                  message={normalisedMessage}
                  regenerate={regenerate}
                  requiresScrollPadding={
                    hasSentMessage && index === safeMessages.length - 1
                  }
                  setMessages={setMessages}
                  vote={matchingVote}
                />
                {invalidCount > 0 ? (
                  <div
                    className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
                    data-testid="chat-artifact-fallback"
                    role="status"
                  >
                    Impossible d’afficher {invalidCount > 1 ? "certaines pièces" : "cette pièce"} jointes en raison d’un format inattendu.
                  </div>
                ) : null}
              </Fragment>
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
  /**
   * Some chat updates (notably finance artefacts and inline edit regenerations)
   * mutate the existing messages array in place while streaming new parts.
   * When React receives the same reference we cannot safely assume the payload
   * stayed identical, so opt-out of memoisation to force a re-render and surface
   * the refreshed assistant content/artifacts.
   */
  if (prevProps.messages === nextProps.messages) {
    return false;
  }

  /**
   * When the finance artefact modal is open we still need to surface new
   * assistant replies (for example follow-up prompts or edits). Only skip the
   * render when the visibility flag itself changed; otherwise fall back to the
   * granular comparisons below so fresh messages are not accidentally dropped.
   */
  if (prevProps.isArtifactVisible !== nextProps.isArtifactVisible) {
    return false;
  }

  if (prevProps.status !== nextProps.status) {
    return false;
  }

  if (prevProps.selectedModelId !== nextProps.selectedModelId) {
    return false;
  }

  if (
    prevProps.financeFeatureEnabledOverride !==
    nextProps.financeFeatureEnabledOverride
  ) {
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

  return true;
});
