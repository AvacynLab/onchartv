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
import { ChatSDKError } from "@/lib/errors";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import {
  ChatComposerPrefillOptions,
  ChatComposerProvider,
} from "./chat-composer-context";
import { Artifact } from "./artifact";
import { useOptionalDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
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
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      if (!isComponentMountedRef.current || !dataPart || !setDataStream) {
        return;
      }

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
   * requête.
   */
  const query =
    typeof searchParams?.get === "function" ? searchParams.get("query") : null;

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);

      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", `/chat/${id}`);
      }
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  /**
   * Les flux de messages peuvent être transitoirement `undefined` pendant le
   * streaming. Ce mémo normalise la valeur pour le rendu et les effets.
   */
  const safeMessages = useMemo<ChatMessage[]>(() => {
    if (!Array.isArray(messages)) {
      return [];
    }

    return messages;
  }, [messages]);

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
          sendMessage={sendMessage}
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


