import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

(globalThis as unknown as { React: typeof React }).React = React;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/ai/providers", () => ({
  myProvider: {
    languageModel: () => ({
      id: "chat-model",
      /**
       * The component only uses the model metadata to populate the model
       * selector. Returning a minimal stub keeps the test focused on the focus
       * management behaviour without coupling to provider internals.
       */
      call: vi.fn(),
    }),
  },
}));

import { MultimodalInput } from "@/components/multimodal-input";

const baseProps: React.ComponentProps<typeof MultimodalInput> = {
  chatId: "chat_1",
  input: "",
  setInput: vi.fn() as any,
  status: "ready" as any,
  stop: vi.fn(),
  attachments: [],
  setAttachments: vi.fn() as any,
  messages: [] as UIMessage[],
  setMessages: vi.fn() as any,
  sendMessage: vi.fn() as any,
  className: undefined,
  selectedVisibilityType: "private",
  selectedModelId: "gpt-4o-mini",
  onModelChange: vi.fn(),
  focusSignal: 0,
  usage: undefined,
};

describe("MultimodalInput", () => {
  it("redirige le focus vers la zone de saisie lorsqu'un signal est émis", async () => {
    const { rerender } = render(<MultimodalInput {...baseProps} />);

    const textarea = screen.getByTestId("multimodal-input");
    textarea.blur();
    expect(textarea).not.toHaveFocus();

    rerender(
      <MultimodalInput
        {...baseProps}
        focusSignal={1}
        input="/backtest AAPL 1D 2020-01-01 2020-12-31 50 200"
      />
    );

    await waitFor(() => expect(screen.getByTestId("multimodal-input")).toHaveFocus());
  });
});
