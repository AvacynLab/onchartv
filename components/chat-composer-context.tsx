"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * Options accepted by the `prefillPrompt` helper. The composer can either
 * replace the existing prompt entirely or append to it, and callers can opt-out
 * of focusing the textarea when they only need to stage text for later edits.
 */
export interface ChatComposerPrefillOptions {
  /** If true, append the prompt to the current input instead of replacing it. */
  readonly append?: boolean;
  /** Whether the chat composer textarea should receive focus. Defaults to true. */
  readonly focus?: boolean;
}

export interface ChatComposerContextValue {
  /** Identifier of the active chat, used for analytics and routing helpers. */
  readonly chatId: string;
  /**
   * Pre-populate the chat composer with a prompt. Consumers can decide whether
   * to append or replace and whether to focus the textarea for immediate edits.
   */
  readonly prefillPrompt: (
    prompt: string,
    options?: ChatComposerPrefillOptions
  ) => void;
  /**
   * Send a raw text prompt immediately. Primarily used by quick actions such as
   * suggested prompts that bypass manual confirmation.
   */
  readonly sendPrompt: (prompt: string) => void;
}

const ChatComposerContext = createContext<ChatComposerContextValue | null>(null);

export function ChatComposerProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: ChatComposerContextValue;
}) {
  return (
    <ChatComposerContext.Provider value={value}>
      {children}
    </ChatComposerContext.Provider>
  );
}

/**
 * Access the chat composer context. The hook intentionally returns `null` when
 * used outside of the provider so unit tests rendering isolated components can
 * supply manual fallbacks without requiring additional wrappers.
 */
export function useChatComposer() {
  return useContext(ChatComposerContext);
}
