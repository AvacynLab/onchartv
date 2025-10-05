import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import { SuggestedActions } from "@/components/suggested-actions";

const noop = () => Promise.resolve();

describe("SuggestedActions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders finance shortcuts when the feature flag is enabled", () => {
    render(
      <SuggestedActions
        chatId="chat-1"
        selectedVisibilityType="private"
        sendMessage={noop}
      />
    );

    expect(screen.getByTestId("suggested-action-1")).toHaveTextContent(
      "/chart BTCUSD 1D"
    );
    expect(screen.getByTestId("suggested-action-2")).toHaveTextContent(
      "/backtest AAPL"
    );
  });

  it("falls back to productivity prompts when finance is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "false");

    render(
      <SuggestedActions
        chatId="chat-1"
        selectedVisibilityType="private"
        sendMessage={noop}
      />
    );

    const firstSuggestion = screen.getByTestId("suggested-action-1");
    expect(firstSuggestion).not.toHaveTextContent("/chart");
    expect(firstSuggestion).toHaveTextContent("stand-up update");
  });
});
