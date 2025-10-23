import { useEffect, useMemo, useRef } from "react";
import type { UseChatHelpers } from "@ai-sdk/react";

import { logPlaywrightStreamDebug } from "@/lib/playwright-debug";
import type { ChatMessage } from "@/lib/types";

/**
 * Type guard used when extracting text previews for the Playwright diagnostics.
 * Keeping the guard local ensures the main chat component stays readable while
 * the debug layer retains full type-safety.
 */
type TextPart = Extract<
  NonNullable<ChatMessage["parts"]>[number],
  { type: "text"; text?: string }
>;

/**
 * Emit a structured debug entry describing the latest data part observed by the
 * chat transport. This mirrors the inline logging previously embedded in the
 * chat component while keeping the render tree focused on UI concerns.
 */
export function logChatDataPartDebug(dataPart: unknown): void {
  logPlaywrightStreamDebug("chat-component", "data-part", () => ({
    partType:
      typeof dataPart === "object" && dataPart && "type" in dataPart
        ? (dataPart as { type?: unknown }).type
        : typeof dataPart,
    hasData:
      typeof dataPart === "object" && dataPart && "data" in dataPart
        ? Boolean((dataPart as { data?: unknown }).data)
        : false,
  }));
}

export type ChatPlaywrightStreamDebugOptions = {
  messages: ChatMessage[] | null | undefined;
  status: UseChatHelpers<ChatMessage>["status"];
};

export type ChatPlaywrightStreamDebugResult = {
  /**
   * Normalised message array that callers can safely consume without guarding
   * for transient `undefined` values exposed by the streaming hook.
   */
  safeMessages: ChatMessage[];
  /**
   * Convenience accessor exposing the number of messages for tests that assert
   * the payload logged to Playwright diagnostics.
   */
  messageCount: number;
};

/**
 * Centralise the Playwright stream diagnostics so the chat component no longer
 * needs to interleave logging concerns with rendering logic. The hook mirrors
 * the previous behaviour: it emits a status snapshot whenever the transport
 * lifecycle changes and publishes a lightweight summary of the current message
 * collection each time the chat state updates.
 */
export function useChatPlaywrightStreamDebug({
  messages,
  status,
}: ChatPlaywrightStreamDebugOptions): ChatPlaywrightStreamDebugResult {
  const safeMessages = useMemo<ChatMessage[]>(() => {
    if (!Array.isArray(messages)) {
      return messages ?? [];
    }

    return messages;
  }, [messages]);

  const messageCount = safeMessages.length;

  useEffect(() => {
    logPlaywrightStreamDebug("chat-component", "status-change", () => ({
      status,
      messageCount,
    }));
  }, [status, messageCount]);

  useEffect(() => {
    logPlaywrightStreamDebug("chat-component", "messages-summary", () => ({
      count: safeMessages.length,
      messages: safeMessages.map((message, index) => {
        const partTypes = Array.isArray(message?.parts)
          ? message!.parts.map((part) =>
              part && typeof part === "object" && "type" in part
                ? (part as { type?: unknown }).type ?? typeof part
                : typeof part
            )
          : null;

        const textPreview = Array.isArray(message?.parts)
          ? message!.parts
              .filter((part): part is TextPart => {
                if (!part || typeof part !== "object") {
                  return false;
                }

                return (
                  "type" in part &&
                  (part as { type?: unknown }).type === "text"
                );
              })
              .map((part) => (part.text ?? "").slice(0, 80))
          : null;

        return {
          index,
          id:
            typeof message?.id === "string" && message.id.trim().length > 0
              ? message.id
              : null,
          role: message?.role ?? "unknown",
          status: message?.status ?? null,
          partTypes,
          textPreview,
        };
      }),
    }));
  }, [safeMessages]);

  /**
   * Track message lifecycle transitions so Playwright can assert that edited
   * prompts drive the assistant from the transient `streaming` state to the
   * terminal `completed` status.  Persisting the previous snapshot in a ref
   * avoids polluting the dependency array while still surfacing every change as
   * a dedicated debug event.
   */
  const previousStatusesRef = useRef<Map<string, ChatMessage["status"] | null>>(
    new Map()
  );

  useEffect(() => {
    const nextStatuses = new Map<string, ChatMessage["status"] | null>();

    safeMessages.forEach((message, index) => {
      if (!message || typeof message !== "object") {
        return;
      }

      const identifier =
        typeof message.id === "string" && message.id.trim().length > 0
          ? message.id
          : `index-${index}`;
      const nextStatus = message.status ?? null;
      const previousStatus = previousStatusesRef.current.get(identifier) ?? null;

      nextStatuses.set(identifier, nextStatus);

      if (previousStatus === nextStatus) {
        return;
      }

      logPlaywrightStreamDebug(
        "chat-component",
        "message-status-transition",
        () => ({
          id: identifier,
          index,
          role: message.role ?? "unknown",
          previousStatus,
          nextStatus,
        })
      );
    });

    previousStatusesRef.current = nextStatuses;
  }, [safeMessages]);

  return { safeMessages, messageCount };
}
