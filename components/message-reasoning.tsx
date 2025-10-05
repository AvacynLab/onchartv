"use client";

import { useEffect, useState } from "react";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "./elements/reasoning";

type MessageReasoningProps = {
  isLoading: boolean;
  reasoning: string;
};

export function MessageReasoning({
  isLoading,
  reasoning,
}: MessageReasoningProps) {
  const [hasBeenStreaming, setHasBeenStreaming] = useState(isLoading);

  useEffect(() => {
    if (isLoading) {
      setHasBeenStreaming(true);
    }
  }, [isLoading]);

  return (
    <Reasoning
      data-testid="message-reasoning"
      defaultOpen={hasBeenStreaming}
      isStreaming={isLoading}
    >
      {/**
       * The reasoning accordion exposes dedicated test ids so Playwright helpers
       * can deterministically locate the toggle button and the rendered
       * explanation, even after the auto-close animation hides the content.
       */}
      <ReasoningTrigger data-testid="message-reasoning-trigger" />
      <ReasoningContent data-testid="message-reasoning-content">
        {reasoning}
      </ReasoningContent>
    </Reasoning>
  );
}
