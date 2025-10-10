import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { Attachment } from "@/lib/types";

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

import {
  MultimodalInput,
  STOP_BUTTON_MINIMUM_DURATION_MS,
} from "@/components/multimodal-input";

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

  it("maintient le bouton d'arrêt visible pendant le délai de refroidissement", async () => {
    vi.useFakeTimers();

    try {
      const { rerender } = render(
        <MultimodalInput
          {...baseProps}
          status="submitted"
        />
      );

      const stopButton = screen.getByTestId("stop-button");
      expect(stopButton).toBeVisible();

      rerender(<MultimodalInput {...baseProps} status="ready" />);

      /**
       * Tant que nous n'avons pas dépassé la fenêtre de grâce, le bouton d'arrêt
       * doit rester présent afin que Playwright puisse le cliquer au besoin.
       */
      await act(async () => {
        vi.advanceTimersByTime(STOP_BUTTON_MINIMUM_DURATION_MS - 50);
      });
      expect(screen.getByTestId("stop-button")).toBeVisible();

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(screen.queryByTestId("stop-button")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("active le bouton d'envoi lorsqu'un message est saisi", async () => {
    const Wrapper = () => {
      const [input, setInput] = React.useState("");
      const [attachments, setAttachments] = React.useState<Attachment[]>([]);

      return (
        <MultimodalInput
          {...baseProps}
          attachments={attachments}
          input={input}
          setAttachments={setAttachments as any}
          setInput={setInput}
        />
      );
    };

    render(<Wrapper />);

    const textarea = screen.getByTestId("multimodal-input");
    fireEvent.change(textarea, { target: { value: "Pourquoi le ciel est bleu?" } });

    const sendButton = await screen.findByTestId("send-button");
    await waitFor(() => expect(sendButton).toBeEnabled());
  });

  it("restaure la saisie depuis le localStorage après hydratation", async () => {
    window.localStorage.setItem("input", JSON.stringify("Bonjour depuis le stockage"));

    const setInput = vi.fn();

    render(
      <MultimodalInput
        {...baseProps}
        input=""
        setInput={setInput as any}
      />
    );

    await waitFor(() => {
      expect(setInput).toHaveBeenCalledWith("Bonjour depuis le stockage");
    });
  });
});
