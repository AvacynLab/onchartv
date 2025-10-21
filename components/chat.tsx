"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { ChatHeader } from "@/components/chat-header";
import { useArtifactSelector } from "@/hooks/use-artifact";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import type { Vote } from "@/lib/db/schema";
import { buildMessageTextSignature } from "@/lib/ai/messages/signature";
import { ChatSDKError } from "@/lib/errors";
import type { Attachment, ChatMessage, MessageMetadata } from "@/lib/types";
import { messageMetadataSchema } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { logWarning } from "@/lib/logging";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import {
  ChatComposerPrefillOptions,
  ChatComposerProvider,
} from "./chat-composer-context";
import { Artifact } from "./artifact";
import { useOptionalDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import {
  logChatDataPartDebug,
  useChatPlaywrightStreamDebug,
} from "@/lib/chat/playwright-stream-debug";
import { useNormaliseChatMessages } from "@/lib/chat/use-normalised-chat-messages";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "./toast";
import type { VisibilityType } from "./visibility-selector";

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
  initialLastContext,
  showNewChatButton = true,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
  initialLastContext?: AppUsage;
  showNewChatButton?: boolean;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  /**
   * Le contexte de stream peut être absent lorsque le composant est monté en
   * isolation (tests unitaires, storybook). Nous le lisons donc de manière
   * opportuniste et basculons en mode no-op lorsque le provider n'est pas
   * disponible afin d'éviter toute exception côté client.
   */
  const dataStreamContext = useOptionalDataStream();
  const setDataStream = dataStreamContext?.setDataStream;

  /**
   * Nous suivons l'état de montage du composant afin d'éviter toute mise à jour
   * d'état lorsque le chat est démonté (ce qui provoquerait des erreurs React
   * lors du streaming).
   */
  const isComponentMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isComponentMountedRef.current = false;
    };
  }, []);

  const [input, setInput] = useState<string>("");
  const [usage, setUsage] = useState<AppUsage | undefined>(initialLastContext);
  const [currentModelId, setCurrentModelId] = useState(initialChatModel);
  const currentModelIdRef = useRef(currentModelId);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<ChatMessage>({
    id,
    /**
     * `useChat` exposes both a controlled `messages` prop and an
     * `initialMessages` seed.  We deliberately rely on the uncontrolled
     * variant so the hook can append streaming payloads to its internal state
     * without React treating our prop as the single source of truth.  Passing
     * the controlled prop here would freeze the conversation to the initial
     * snapshot (an empty array during first render) which is exactly what the
     * Playwright suite observed when no assistant bubble ever appeared.
     */
    initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const baseBody =
          typeof request.body === "object" && request.body !== null
            ? { ...(request.body as Record<string, unknown>) }
            : {};

        const providedMessage =
          typeof baseBody.message === "object" && baseBody.message !== null
            ? (baseBody.message as ChatMessage)
            : undefined;

        const lastMessage = providedMessage ?? request.messages.at(-1);

        let messageWithSignature: ChatMessage | undefined;

        if (lastMessage) {
          const parts = Array.isArray(lastMessage.parts)
            ? lastMessage.parts
            : [];

          const signature = buildMessageTextSignature(parts);
          const rawMetadata =
            typeof lastMessage.metadata === "object" && lastMessage.metadata !== null
              ? lastMessage.metadata
              : {};

          /**
           * Nous nous assurons que les métadonnées disposent toujours d'un
           * horodatage valide afin de satisfaire le schéma partagé
           * `messageMetadataSchema`. Les prompts édités peuvent ne fournir
           * qu'une empreinte client : nous reconstruisons donc un objet
           * complet avant de lui adjoindre la nouvelle signature.
           */
          const metadataCandidate = {
            ...rawMetadata,
            createdAt:
              typeof (rawMetadata as { createdAt?: unknown }).createdAt === "string"
                ? (rawMetadata as { createdAt: string }).createdAt
                : new Date().toISOString(),
          };

          const metadataResult = messageMetadataSchema.safeParse(metadataCandidate);

          const metadataWithSignature: MessageMetadata = metadataResult.success
            ? {
                ...metadataResult.data,
                clientTextSignature: signature,
              }
            : {
                createdAt: new Date().toISOString(),
                clientTextSignature: signature,
              };

          messageWithSignature = {
            ...lastMessage,
            metadata: metadataWithSignature,
          };
        }

        const bodyPayload: Record<string, unknown> = {
          ...baseBody,
          id: request.id,
          selectedChatModel: currentModelIdRef.current,
          selectedVisibilityType: visibilityType,
        };

        if (messageWithSignature) {
          bodyPayload.message = messageWithSignature;
        }

        return {
          body: bodyPayload,
        };
      },
    }),
    onData: (dataPart) => {
      if (!isComponentMountedRef.current || !dataPart || !setDataStream) {
        return;
      }

      logChatDataPartDebug(dataPart);

      setDataStream((previousParts) => {
        const safePreviousParts = Array.isArray(previousParts)
          ? previousParts
          : [];

        return [...safePreviousParts, dataPart];
      });

      if (dataPart.type === "data-usage" && dataPart.data) {
        setUsage(dataPart.data);
      }
    },
    onFinish: () => {
      if (typeof mutate === "function") {
        mutate(unstable_serialize(getChatHistoryPaginationKey));
      }
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({
          type: "error",
          description: error.message,
        });
      }
    },
  });

  const searchParams = useSearchParams();
  /**
   * En environnement de test ou lorsque le hook n'est pas initialisé, l'accès
   * aux paramètres peut échouer. Nous défendons donc l'accès au paramètre de
   * requête et ne conservons qu'une valeur non vide une fois normalisée.
   */
  const initialQuery = useMemo(() => {
    if (typeof searchParams?.get !== "function") {
      return null;
    }

    const rawValue = searchParams.get("query");
    if (typeof rawValue !== "string") {
      return null;
    }

    const trimmed = rawValue.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [searchParams]);

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (!initialQuery || hasAppendedQuery) {
      return;
    }

    sendMessage({
      role: "user" as const,
      parts: [{ type: "text", text: initialQuery }],
    });

    setHasAppendedQuery(true);

    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [initialQuery, sendMessage, hasAppendedQuery, id]);

  /**
   * Centralise the Playwright diagnostics in a dedicated hook so the render
   * path remains focused on UI concerns while the debug layer retains access to
   * the streaming lifecycle. The hook mirrors the previous inline behaviour:
   * it logs status transitions and snapshots of the current message array
   * whenever the chat state changes.
   */
  const { safeMessages } = useChatPlaywrightStreamDebug({
    messages,
    status,
  });

  /**
   * Les flux d'assistant observés via Playwright exposent parfois des messages
   * dépourvus d'identifiant stable. Le hook dédié encapsule la logique de
   * normalisation afin de conserver un état cohérent pour les actions (votes,
   * édition) et pour les outils de synchronisation e2e, tout en regroupant les
   * diagnostics au même endroit que la mise à jour de l'état.
   */
  useNormaliseChatMessages({
    chatId: id,
    messages,
    setMessages,
    onIdentifierPatches: (patches) => {
      for (const patch of patches) {
        logWarning(
          "chat:messages",
          "[Chat] synthesised fallback identifier for streamed message",
          {
            chatId: id,
            fallbackMessageId: patch.fallbackId,
            index: patch.index,
            role: patch.role,
          }
        );
      }
    },
  });

  const { data: votes } = useSWR<Vote[]>(
    safeMessages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher
  );

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const prefillPrompt = useCallback(
    (prompt: string, options?: ChatComposerPrefillOptions) => {
      setInput((previous) => {
        if (options?.append) {
          const trimmed = previous.trimEnd();
          const separator = trimmed.length > 0 && !trimmed.endsWith(" ") ? " " : "";
          return `${trimmed}${separator}${prompt}`;
        }

        return prompt;
      });

      if (options?.focus ?? true) {
        setComposerFocusSignal((signal) => signal + 1);
      }
    },
    [setInput, setComposerFocusSignal]
  );

  const sendPrompt = useCallback(
    (prompt: string) => {
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", `/chat/${id}`);
      }

      sendMessage({
        role: "user" as const,
        parts: [{ type: "text" as const, text: prompt }],
      });
    },
    [id, sendMessage]
  );

  const composerContextValue = useMemo(
    () => ({ chatId: id, prefillPrompt, sendPrompt }),
    [id, prefillPrompt, sendPrompt]
  );

  return (
    <ChatComposerProvider value={composerContextValue}>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader
          chatId={id}
          isReadonly={isReadonly}
          selectedVisibilityType={initialVisibilityType}
          showNewChatButton={showNewChatButton}
        />

        <Messages
          chatId={id}
          isArtifactVisible={isArtifactVisible}
          isReadonly={isReadonly}
          messages={safeMessages}
          regenerate={regenerate}
          selectedModelId={initialChatModel}
          setMessages={setMessages}
          status={status}
          votes={votes}
        />

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {!isReadonly && (
            <MultimodalInput
              attachments={attachments}
              chatId={id}
              input={input}
              messages={safeMessages}
              onModelChange={setCurrentModelId}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              focusSignal={composerFocusSignal}
              status={status}
              stop={stop}
              usage={usage}
            />
          )}
        </div>
      </div>

      <Artifact
        attachments={attachments}
        chatId={id}
        input={input}
        isReadonly={isReadonly}
        messages={safeMessages}
        regenerate={regenerate}
        selectedModelId={currentModelId}
        selectedVisibilityType={visibilityType}
        sendMessage={sendMessage}
        setAttachments={setAttachments}
        setInput={setInput}
        setMessages={setMessages}
        focusSignal={composerFocusSignal}
        status={status}
        stop={stop}
        votes={votes}
      />

    </ChatComposerProvider>
  );
}


