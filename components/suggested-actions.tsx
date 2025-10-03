"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { motion } from "framer-motion";
import React, { memo } from "react";
import type { ChatMessage } from "@/lib/types";
import { isFinanceFeatureEnabledClient } from "@/lib/feature-flags";
import { Suggestion } from "./elements/suggestion";
import type { VisibilityType } from "./visibility-selector";

type SuggestedActionsProps = {
  chatId: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  selectedVisibilityType: VisibilityType;
};

function PureSuggestedActions({ chatId, sendMessage }: SuggestedActionsProps) {
  /**
   * Keep the first suggestion anchored to the long-standing onboarding prompt so
   * the regression suite continues to assert the deterministic "With Next.js,
   * you can ship fast!" response while the remaining entries highlight the new
   * finance shortcuts.
   */
  const financeFeatureEnabled = isFinanceFeatureEnabledClient();

  /**
   * Keep a core onboarding suggestion regardless of feature flags so the chat
   * regression suite continues to assert the deterministic Next.js welcome
   * response.
   */
  const baselineSuggestions = ["What are the advantages of using Next.js?"];
  const financeSuggestions = [
    "/chart BTCUSD 1D",
    "/backtest AAPL 2018-01-01 2020-12-31 50 200",
    "Summarise NVDA fundamentals using the finance artefacts",
    "Toggle the finance news preference and explain what changes",
  ];
  /**
   * Provide non-finance alternatives when the feature flag is disabled so the
   * UI still exposes a diverse set of quick-start prompts.
   */
  const productivitySuggestions = [
    "Draft a stand-up update for a frontend engineer",
    "Summarise the latest conversation in three bullet points",
  ];

  const suggestedActions = financeFeatureEnabled
    ? [...baselineSuggestions, ...financeSuggestions]
    : [...baselineSuggestions, ...productivitySuggestions];

  return (
    <div
      className="grid w-full gap-2 sm:grid-cols-2"
      data-testid="suggested-actions"
    >
      {suggestedActions.map((suggestedAction, index) => {
        /**
         * Surface deterministic test identifiers for each suggestion so the
         * Playwright helpers can reliably locate the button regardless of text
         * layout differences (for example when fonts fall back to system
         * variants during offline runs). Indexing keeps the IDs simple while
         * remaining stable because the suggestion order is hard-coded.
         *
         * The list now intentionally mixes raw slash commands with plain
         * English prompts so newcomers discover the finance shortcuts without
         * sacrificing more narrative-driven entry points.
         */
        const suggestionTestId = `suggested-action-${index}`;

        return (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            initial={{ opacity: 0, y: 20 }}
            key={suggestedAction}
            transition={{ delay: 0.05 * index }}
          >
            <Suggestion
              className="h-auto w-full whitespace-normal p-3 text-left"
              data-testid={suggestionTestId}
              onClick={(suggestion) => {
                window.history.replaceState({}, "", `/chat/${chatId}`);
                sendMessage({
                  role: "user",
                  parts: [{ type: "text", text: suggestion }],
                });
              }}
              suggestion={suggestedAction}
            >
              {suggestedAction}
            </Suggestion>
          </motion.div>
        );
      })}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }

    return true;
  }
);
