import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";

const sendMessageMock = vi.fn();
const setMessagesMock = vi.fn();
const stopMock = vi.fn();
const regenerateMock = vi.fn();
const resumeStreamMock = vi.fn();
const toastMock = vi.fn();

let mockMessages: ChatMessage[] | undefined;
let mockStatus: "idle" | "loading" | "streaming" | "submitted";
let latestUsage: AppUsage | undefined;
let latestMultimodalMessages: ChatMessage[] | undefined;
let latestMessagesProp: ChatMessage[] | undefined;
let latestArtifactMessages: ChatMessage[] | undefined;
let latestUseChatConfig: any;
let storedStream: unknown[] = [];
const setDataStreamMock = vi.fn();
let shouldExposeDataStream = true;
let searchParamsMock: { get: (key: string) => string | null } | null = null;

vi.mock("@/components/toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("@/hooks/use-chat-visibility", () => ({
  useChatVisibility: () => ({
    visibilityType: "private",
    setVisibilityType: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-artifact", () => ({
  useArtifactSelector: () => false,
}));

vi.mock("@/hooks/use-auto-resume", () => ({
  useAutoResume: vi.fn(),
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const PassThrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );

  return {
    AlertDialog: PassThrough,
    AlertDialogTrigger: PassThrough,
    AlertDialogContent: PassThrough,
    AlertDialogHeader: PassThrough,
    AlertDialogFooter: PassThrough,
    AlertDialogTitle: PassThrough,
    AlertDialogDescription: PassThrough,
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
    }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children }: { children?: React.ReactNode }) => (
      <button type="button">{children}</button>
    ),
  };
});

vi.mock("@/components/chat-header", () => ({
  ChatHeader: () => <div data-testid="chat-header" />,
}));

vi.mock("@/components/messages", () => ({
  Messages: ({ messages }: { messages: ChatMessage[] }) => {
    latestMessagesProp = messages;
    return (
      <div data-testid="messages-count">{messages.length}</div>
    );
  },
}));

vi.mock("@/components/multimodal-input", () => ({
  MultimodalInput: ({
    messages,
    sendMessage,
    usage,
  }: {
    messages: ChatMessage[];
    sendMessage: (message: ChatMessage) => void;
    usage?: AppUsage;
  }) => {
    latestMultimodalMessages = messages;
    latestUsage = usage;
    return (
      <button
        data-testid="chat-send"
        onClick={() =>
          sendMessage({
            id: "user-message",
            role: "user",
            parts: [{ type: "text", text: "Salut" }],
          } as unknown as ChatMessage)
        }
        type="button"
      >
        Envoyer
      </button>
    );
  },
}));

vi.mock("@/components/artifact", () => ({
  Artifact: ({ messages }: { messages: ChatMessage[] }) => {
    latestArtifactMessages = messages;
    return <div data-testid="artifact" />;
  },
}));

vi.mock("@/components/data-stream-provider", () => ({
  useOptionalDataStream: () => {
    if (!shouldExposeDataStream) {
      return null;
    }

    return {
      dataStream: storedStream,
      setDataStream: (updater: unknown) => {
        setDataStreamMock(updater);
        if (typeof updater === "function") {
          storedStream = (updater as (current: unknown[]) => unknown[])(
            Array.isArray(storedStream) ? storedStream : []
          );
        } else {
          storedStream = Array.isArray(updater) ? updater : [];
        }
      },
    };
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (config: unknown) => {
    latestUseChatConfig = config;
    return {
      messages: mockMessages,
      setMessages: setMessagesMock,
      sendMessage: sendMessageMock,
      status: mockStatus,
      stop: stopMock,
      regenerate: regenerateMock,
      resumeStream: resumeStreamMock,
    };
  },
}));

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(public readonly options?: unknown) {}
  },
}));

const { Chat } = await import("@/components/chat");

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
);

beforeEach(() => {
  mockMessages = undefined;
  mockStatus = "idle";
  latestUsage = undefined;
  latestMultimodalMessages = undefined;
  latestMessagesProp = undefined;
  latestArtifactMessages = undefined;
  latestUseChatConfig = undefined;
  storedStream = [];
  sendMessageMock.mockReset();
  setMessagesMock.mockReset();
  stopMock.mockReset();
  regenerateMock.mockReset();
  resumeStreamMock.mockReset();
  toastMock.mockReset();
  setDataStreamMock.mockReset();
  shouldExposeDataStream = true;
  searchParamsMock = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Chat", () => {
  it("normalise les messages avant de les propager", () => {
    render(
      <Chat
        autoResume={false}
        id="chat-1"
        initialChatModel="model"
        initialLastContext={undefined}
        initialMessages={[]}
        initialVisibilityType="private"
        isReadonly={false}
      />,
      { wrapper: Wrapper }
    );

    expect(Array.isArray(latestMessagesProp)).toBe(true);
    expect(Array.isArray(latestMultimodalMessages)).toBe(true);
    expect(Array.isArray(latestArtifactMessages)).toBe(true);
    expect(latestMessagesProp).toHaveLength(0);
    expect(latestMultimodalMessages).toHaveLength(0);
    expect(latestArtifactMessages).toHaveLength(0);
  });

  it("transmet le gestionnaire d'envoi sans lever d'exception", () => {
    mockMessages = [];

    render(
      <Chat
        autoResume={false}
        id="chat-2"
        initialChatModel="model"
        initialLastContext={undefined}
        initialMessages={[]}
        initialVisibilityType="private"
        isReadonly={false}
      />,
      { wrapper: Wrapper }
    );

    fireEvent.click(screen.getByTestId("chat-send"));

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toMatchObject({
      role: "user",
    });
  });

  it("gère les fragments de stream uniquement quand monté", async () => {
    mockMessages = [];

    const { unmount } = render(
      <Chat
        autoResume={false}
        id="chat-3"
        initialChatModel="model"
        initialLastContext={undefined}
        initialMessages={[]}
        initialVisibilityType="private"
        isReadonly={false}
      />,
      { wrapper: Wrapper }
    );

    expect(typeof latestUseChatConfig?.onData).toBe("function");

    await act(async () => {
      latestUseChatConfig.onData?.(null);
    });
    expect(setDataStreamMock).not.toHaveBeenCalled();

    await act(async () => {
      latestUseChatConfig.onData?.({
        type: "chunk",
        data: { content: "hello" },
      });
    });

    expect(setDataStreamMock).toHaveBeenCalledTimes(1);
    expect(Array.isArray(storedStream)).toBe(true);
    expect(storedStream).toHaveLength(1);

    await act(async () => {
      latestUseChatConfig.onData?.({
        type: "data-usage",
        data: { tokens: 42 },
      });
    });

    await waitFor(() => {
      expect(latestUsage).toEqual({ tokens: 42 });
    });

    setDataStreamMock.mockClear();
    unmount();

    await act(async () => {
      latestUseChatConfig.onData?.({
        type: "chunk",
        data: { content: "late" },
      });
    });

    expect(setDataStreamMock).not.toHaveBeenCalled();
  });

  it("ignore les fragments lorsque le provider de stream est absent", async () => {
    shouldExposeDataStream = false;
    mockMessages = [];

    render(
      <Chat
        autoResume={false}
        id="chat-4"
        initialChatModel="model"
        initialLastContext={undefined}
        initialMessages={[]}
        initialVisibilityType="private"
        isReadonly={false}
      />,
      { wrapper: Wrapper }
    );

    await act(async () => {
      latestUseChatConfig.onData?.({
        type: "chunk",
        data: { content: "ghost" },
      });
    });

    expect(setDataStreamMock).not.toHaveBeenCalled();
  });

  it("envoie le paramètre de requête initial après normalisation", async () => {
    searchParamsMock = {
      get: (key: string) => (key === "query" ? "   Première requête  " : null),
    };

    render(
      <Chat
        autoResume={false}
        id="chat-5"
        initialChatModel="model"
        initialLastContext={undefined}
        initialMessages={[]}
        initialVisibilityType="private"
        isReadonly={false}
      />,
      { wrapper: Wrapper }
    );

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          parts: [expect.objectContaining({ text: "Première requête" })],
        })
      );
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it("ignore les paramètres de requête vides ou blancs", async () => {
    searchParamsMock = {
      get: (key: string) => (key === "query" ? "    " : null),
    };

    render(
      <Chat
        autoResume={false}
        id="chat-6"
        initialChatModel="model"
        initialLastContext={undefined}
        initialMessages={[]}
        initialVisibilityType="private"
        isReadonly={false}
      />,
      { wrapper: Wrapper }
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
