import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";

import { DataStreamProvider } from "@/components/data-stream-provider";
import type { ChatMessage } from "@/lib/types";

const noop = () => {};

const previewMessageSpy = vi.fn(
  ({ message }: { message: ChatMessage }) => (
    <div data-testid={`message-${message.role}`}>{message.id}</div>
  )
);

vi.mock("@/components/message", () => ({
  PreviewMessage: (props: { message: ChatMessage }) => {
    previewMessageSpy(props);
    const { message } = props;
    return <div data-testid={`message-${message.role}`}>{message.id}</div>;
  },
  ThinkingMessage: () => <div data-testid="thinking-message" />,
}));

const mockUseMessages = vi.fn();

vi.mock("@/hooks/use-messages", () => ({
  useMessages: (...args: unknown[]) => mockUseMessages(...args),
}));

const { Messages } = await import("@/components/messages");

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>
    <DataStreamProvider>{children}</DataStreamProvider>
  </SWRConfig>
);

type MockHookState = {
  containerRef: React.RefObject<HTMLDivElement>;
  endRef: React.RefObject<HTMLDivElement>;
  isAtBottom: boolean;
  scrollToBottom: ReturnType<typeof vi.fn>;
  onViewportEnter: ReturnType<typeof vi.fn>;
  onViewportLeave: ReturnType<typeof vi.fn>;
  hasSentMessage: boolean;
};

function createHookState(): MockHookState {
  const containerRef = React.createRef<HTMLDivElement>();
  const endRef = React.createRef<HTMLDivElement>();

  return {
    containerRef,
    endRef,
    isAtBottom: true,
    scrollToBottom: vi.fn(),
    onViewportEnter: vi.fn(),
    onViewportLeave: vi.fn(),
    hasSentMessage: false,
  };
}

let hookState: MockHookState;

beforeAll(() => {
  class ResizeObserverMock implements ResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe() {
      const entry: ResizeObserverEntry = {
        target: document.createElement("div"),
        contentRect: {
          width: 640,
          height: 480,
          x: 0,
          y: 0,
          top: 0,
          right: 640,
          bottom: 480,
          left: 0,
          toJSON: () => ({}),
        },
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      };

      this.callback([entry], this as unknown as ResizeObserver);
    }

    unobserve() {}

    disconnect() {}

    takeRecords(): ResizeObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

beforeEach(() => {
  mockUseMessages.mockReset();
  hookState = createHookState();
  mockUseMessages.mockReturnValue(hookState);
  previewMessageSpy.mockClear();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Messages", () => {
  it("affiche une salutation lorsque la liste est vide", () => {
    render(
      <Messages
        chatId="chat-1"
        isArtifactVisible={false}
        isReadonly={false}
        messages={undefined}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="idle"
        votes={undefined}
      />,
      { wrapper: Wrapper }
    );

    expect(screen.getByText(/hello there!/i)).toBeInTheDocument();
    expect(screen.queryByTestId("chat-message-fallback")).not.toBeInTheDocument();
  });

  it("rend un fallback lorsque le message est malformé", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(noop);

    render(
      <Messages
        chatId="chat-1"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[{ id: "broken" } as unknown as ChatMessage]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="idle"
        votes={undefined}
      />,
      { wrapper: Wrapper }
    );

    expect(screen.getByTestId("chat-message-fallback")).toHaveTextContent(
      /message indisponible/i
    );
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("affiche les messages valides et ignore les votes manquants", () => {
    const message = {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "Salut" }],
      metadata: { createdAt: new Date().toISOString() },
      artifacts: null,
    } as unknown as ChatMessage;

    render(
      <Messages
        chatId="chat-1"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[message]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="streaming"
        votes={null}
      />,
      { wrapper: Wrapper }
    );

    expect(screen.getByTestId("message-user")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-message-fallback")).not.toBeInTheDocument();
    expect(previewMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ artifacts: [] }),
      })
    );
  });

  it("normalise les artefacts avant de les propager aux enfants", () => {
    const assistantMessage = {
      id: "msg-2",
      role: "assistant",
      parts: [{ type: "text", text: "Voici un artefact" }],
      metadata: { createdAt: new Date().toISOString() },
      artifacts: undefined,
    } as unknown as ChatMessage;

    render(
      <Messages
        chatId="chat-1"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[assistantMessage]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="idle"
        votes={[]}
      />,
      { wrapper: Wrapper }
    );

    expect(previewMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ artifacts: [] }),
      })
    );
  });

  it("affiche le bouton de scroll lorsque l’utilisateur s’éloigne du bas", () => {
    hookState.isAtBottom = false;

    render(
      <Messages
        chatId="chat-1"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="idle"
        votes={undefined}
      />,
      { wrapper: Wrapper }
    );

    const button = screen.getByTestId("scroll-to-bottom-button");
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(hookState.scrollToBottom).toHaveBeenCalledWith("smooth");
  });

  it("ne déclenche l’auto-scroll que si un nouveau message arrive", async () => {
    const initialMessage = {
      id: "msg-1",
      role: "assistant",
      parts: [{ type: "text", text: "Bonjour" }],
      metadata: { createdAt: new Date().toISOString() },
    } as unknown as ChatMessage;

    const nextMessage = {
      id: "msg-2",
      role: "user",
      parts: [{ type: "text", text: "Salut" }],
      metadata: { createdAt: new Date().toISOString() },
    } as unknown as ChatMessage;

    hookState.isAtBottom = true;

    const { rerender } = render(
      <Messages
        chatId="chat-1"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[initialMessage]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="streaming"
        votes={undefined}
      />,
      { wrapper: Wrapper }
    );

    hookState.scrollToBottom.mockClear();

    rerender(
      <Messages
        chatId="chat-1"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[initialMessage, nextMessage]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="submitted"
        votes={undefined}
      />
    );

    await waitFor(() => {
      expect(hookState.scrollToBottom).toHaveBeenCalledWith("smooth");
    });
  });

  it("ne force pas l’auto-scroll lorsque l’utilisateur consulte l’historique", async () => {
    const initialMessage = {
      id: "msg-1",
      role: "assistant",
      parts: [{ type: "text", text: "Bonjour" }],
      metadata: { createdAt: new Date().toISOString() },
    } as unknown as ChatMessage;

    const nextMessage = {
      id: "msg-2",
      role: "assistant",
      parts: [{ type: "text", text: "Encore là" }],
      metadata: { createdAt: new Date().toISOString() },
    } as unknown as ChatMessage;

    hookState.isAtBottom = false;

    const { rerender } = render(
      <Messages
        chatId="chat-1"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[initialMessage]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="streaming"
        votes={undefined}
      />,
      { wrapper: Wrapper }
    );

    hookState.scrollToBottom.mockClear();

    rerender(
      <Messages
        chatId="chat-1"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[initialMessage, nextMessage]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="streaming"
        votes={undefined}
      />
    );

    await waitFor(() => {
      expect(hookState.scrollToBottom).not.toHaveBeenCalled();
    });
  });
});
