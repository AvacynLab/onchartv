import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import * as logging from "@/lib/logging";
import type { StructuredLogEntry } from "@/lib/logging";
import * as featureFlags from "@/lib/feature-flags";

import { DataStreamProvider } from "@/components/data-stream-provider";
import type { ChatMessage } from "@/lib/types";
import type {
  FinanceBacktestArtifact,
  FinanceChartArtifact,
} from "@/lib/finance/types";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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
    const warnSpy = vi
      .spyOn(logging, "logWarning")
      .mockImplementation((context, message, extra) => ({
        context,
        level: "warn",
        message: typeof message === "string" ? message : undefined,
        timestamp: new Date().toISOString(),
        extra,
      }) satisfies StructuredLogEntry);

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

  it("hydrate les artefacts finance stockés dans les data parts", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");

    const chartArtifact: FinanceChartArtifact = {
      type: "finance.chart",
      symbol: "BTCUSD",
      timeframe: "1D",
      range: { from: "2024-01-01", to: "2024-01-31" },
      ohlcv: [
        { t: 1704067200, o: 42_000, h: 43_000, l: 41_500, c: 42_750, v: 12_345 },
      ],
      overlays: [],
    };

    const financeMessage = {
      id: "assistant-finance-1",
      role: "assistant",
      metadata: { createdAt: new Date().toISOString() },
      parts: [
        { id: "text-1", type: "text", text: "Voici le graphique demandé" },
        { type: "data-financeChart", data: chartArtifact },
      ],
    } as unknown as ChatMessage;

    render(
      <Messages
        chatId="chat-finance"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[financeMessage]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="idle"
        votes={undefined}
      />,
      { wrapper: Wrapper }
    );

    const latestInvocation = previewMessageSpy.mock.calls.at(-1)?.[0] as
      | { message?: ChatMessage }
      | undefined;

    expect(latestInvocation?.message?.artifacts).toEqual([chartArtifact]);
  });

  it("normalise les artefacts finance persistés via l'enveloppe message", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");

    const backtestPayload: FinanceBacktestArtifact = {
      type: "finance.backtest",
      runId: "wrapped-1",
      symbol: "AAPL",
      timeframe: "1D",
      period: { from: "2022-01-01", to: "2022-12-31" },
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 20, slowPeriod: 50 },
      },
      metrics: {
        totalReturn: 0.34,
        cagr: 0.29,
        maxDrawdown: 0.12,
        winRate: 0.61,
        averageWin: 4200,
        averageLoss: -1500,
        sharpe: 1.4,
        profitFactor: 2.7,
        trades: 8,
      },
      equityCurve: [{ t: 1640995200, e: 10_000 }],
      trades: [
        {
          entryTimestamp: 1640995200,
          entryPrice: 150,
          exitTimestamp: 1643673600,
          exitPrice: 165,
          quantity: 5,
          grossPnl: 75,
          netPnl: 72,
        },
      ],
      commentary: "wrapped payload",
    };

    const messageWithWrappedArtifact = {
      id: "assistant-finance-wrapped",
      role: "assistant",
      metadata: { createdAt: new Date().toISOString() },
      parts: [
        { id: "text-1", type: "text", text: "Résultats du backtest" },
      ],
      artifacts: [
        {
          type: "finance.backtest",
          payload: backtestPayload,
        },
      ],
    } as unknown as ChatMessage;

    render(
      <Messages
        chatId="chat-finance"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[messageWithWrappedArtifact]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="idle"
        votes={undefined}
      />,
      { wrapper: Wrapper }
    );

    const latestInvocation = previewMessageSpy.mock.calls.at(-1)?.[0] as
      | { message?: ChatMessage }
      | undefined;

    expect(latestInvocation?.message?.artifacts).toEqual([backtestPayload]);
  });

  it("déduplique les artefacts finance présents à la fois dans parts et artifacts", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");

    const artifact: FinanceBacktestArtifact = {
      type: "finance.backtest",
      runId: "dedupe-1",
      symbol: "NVDA",
      timeframe: "1D",
      period: { from: "2024-01-01", to: "2024-06-30" },
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 10, slowPeriod: 30 },
      },
      metrics: {
        totalReturn: 0.12,
        cagr: 0.18,
        maxDrawdown: 0.08,
        winRate: 0.55,
        averageWin: 3200,
        averageLoss: -1400,
        sharpe: 1.1,
        profitFactor: 1.8,
        trades: 6,
      },
      equityCurve: [{ t: 1704067200, e: 10_000 }],
      trades: [
        {
          entryTimestamp: 1704067200,
          entryPrice: 450,
          exitTimestamp: 1706745600,
          exitPrice: 470,
          quantity: 2,
          grossPnl: 40,
          netPnl: 38,
        },
      ],
      commentary: "dedupe payload",
    };

    const message = {
      id: "assistant-dedupe",
      role: "assistant",
      metadata: { createdAt: new Date().toISOString() },
      parts: [
        { id: "text", type: "text", text: "Analyse du backtest" },
        { type: "data-financeBacktest", data: artifact },
      ],
      artifacts: [
        {
          type: "finance.backtest",
          payload: artifact,
        },
      ],
    } as unknown as ChatMessage;

    render(
      <Messages
        chatId="chat-finance"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[message]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="idle"
        votes={undefined}
      />,
      { wrapper: Wrapper }
    );

    const latestInvocation = previewMessageSpy.mock.calls.at(-1)?.[0] as
      | { message?: ChatMessage }
      | undefined;

    expect(latestInvocation?.message?.artifacts).toEqual([artifact]);

    const financeParts = latestInvocation?.message?.parts?.filter(
      (part) => part.type === "data-financeBacktest"
    );

    expect(financeParts).toHaveLength(1);
    expect(
      (financeParts?.[0] as { transient?: boolean } | undefined)?.transient ?? false
    ).toBe(false);
  });

  it("filtre les doublons de parts finance injectés pendant le streaming", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");

    const artifact: FinanceBacktestArtifact = {
      type: "finance.backtest",
      runId: "streamed-duplicate",
      symbol: "NVDA",
      timeframe: "4H",
      period: { from: "2024-02-01", to: "2024-03-01" },
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 12, slowPeriod: 26 },
      },
      metrics: {
        totalReturn: 0.08,
        cagr: 0.11,
        maxDrawdown: 0.05,
        winRate: 0.6,
        averageWin: 1100,
        averageLoss: -500,
        sharpe: 0.9,
        profitFactor: 1.5,
        trades: 5,
      },
      equityCurve: [{ t: 1706745600, e: 10_000 }],
      trades: [
        {
          entryTimestamp: 1706745600,
          entryPrice: 410,
          exitTimestamp: 1707436800,
          exitPrice: 418,
          quantity: 3,
          grossPnl: 24,
          netPnl: 22,
        },
      ],
      commentary: "duplicate parts should collapse",
    };

    const messageWithDuplicateParts = {
      id: "assistant-streaming-dedupe",
      role: "assistant",
      metadata: { createdAt: new Date().toISOString() },
      parts: [
        { id: "text", type: "text", text: "Streaming backtest" },
        { type: "data-financeBacktest", data: artifact, transient: true },
        { type: "data-financeBacktest", data: { ...artifact } },
      ],
      artifacts: [],
    } as unknown as ChatMessage;

    render(
      <Messages
        chatId="chat-finance"
        isArtifactVisible={false}
        isReadonly={false}
        messages={[messageWithDuplicateParts]}
        regenerate={noop as any}
        selectedModelId="model"
        setMessages={noop as any}
        status="idle"
        votes={undefined}
      />,
      { wrapper: Wrapper }
    );

    const latestInvocation = previewMessageSpy.mock.calls.at(-1)?.[0] as
      | { message?: ChatMessage }
      | undefined;

    const financeParts = latestInvocation?.message?.parts?.filter(
      (part) => part.type === "data-financeBacktest"
    );

    expect(financeParts).toHaveLength(1);
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

  it("affiche un fallback lorsque des artefacts sont malformés", () => {
    const warnSpy = vi
      .spyOn(logging, "logWarning")
      .mockImplementation((context, message, extra) => ({
        context,
        level: "warn",
        message: typeof message === "string" ? message : undefined,
        timestamp: new Date().toISOString(),
        extra,
      }) satisfies StructuredLogEntry);

    const assistantMessage = {
      id: "msg-3",
      role: "assistant",
      parts: [{ type: "text", text: "Artefacts multiples" }],
      metadata: { createdAt: new Date().toISOString() },
      artifacts: [null, { type: "finance.chart", payload: { foo: "bar" } }, 42],
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

    const fallback = screen.getByTestId("chat-artifact-fallback");
    expect(fallback).toHaveTextContent(/Impossible d’afficher/);

    expect(warnSpy).toHaveBeenCalled();

    const payloads = warnSpy.mock.calls.map(([, , details]) => details);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issues: expect.arrayContaining([expect.any(String)]),
        }),
      ])
    );

    warnSpy.mockRestore();
  });

  it("propage les artefacts finance valides aux enfants", () => {
    const chartArtifact: FinanceChartArtifact = {
      type: "finance.chart",
      symbol: "AAPL",
      timeframe: "1D",
      range: { from: "2024-01-01", to: "2024-01-31" },
      ohlcv: [
        {
          t: 1_704_065_600,
          o: 150,
          h: 155,
          l: 148,
          c: 154,
          v: 1_200_000,
        },
      ],
      overlays: [],
    };

    const assistantMessage = {
      id: "msg-4",
      role: "assistant",
      parts: [{ type: "text", text: "Artefact valide" }],
      metadata: { createdAt: new Date().toISOString() },
      artifacts: [chartArtifact],
    } as unknown as ChatMessage;

    render(
      <Messages
        chatId="chat-2"
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
        message: expect.objectContaining({
          artifacts: [
            expect.objectContaining({
              type: "finance.chart",
              symbol: "AAPL",
            }),
          ],
        }),
      })
    );
  });

  it("masque les artefacts finance lorsque le flag est désactivé", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "false");

    const flagSpy = vi.spyOn(
      featureFlags,
      "isFinanceFeatureEnabledClient"
    );
    const warnSpy = vi
      .spyOn(logging, "logWarning")
      .mockImplementation((context, message, extra) => ({
        context,
        level: "warn",
        timestamp: new Date().toISOString(),
        message: typeof message === "string" ? message : undefined,
        extra,
      }) satisfies StructuredLogEntry);

    const chartArtifact: FinanceChartArtifact = {
      type: "finance.chart",
      symbol: "BTCUSD",
      timeframe: "1H",
      range: { from: "2024-02-01", to: "2024-02-15" },
      ohlcv: [
        {
          t: 1_706_070_400,
          o: 42_000,
          h: 42_800,
          l: 41_900,
          c: 42_500,
          v: 8_500,
        },
      ],
      overlays: [],
    };

    const assistantMessage = {
      id: "msg-flagged",
      role: "assistant",
      parts: [{ type: "text", text: "Finance hidden" }],
      metadata: { createdAt: new Date().toISOString() },
      artifacts: [chartArtifact],
    } as unknown as ChatMessage;

    render(
      <Messages
        chatId="chat-flagged"
        financeFeatureEnabledOverride={false}
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

    expect(previewMessageSpy).toHaveBeenCalledTimes(1);

    const [[previewProps]] = previewMessageSpy.mock.calls;
    expect(previewProps.message.artifacts).toEqual([]);

    expect(screen.queryByTestId("chat-artifact-fallback")).not.toBeInTheDocument();

    expect(flagSpy).not.toHaveBeenCalled();

    expect(warnSpy).toHaveBeenCalledWith(
      "chat:messages",
      expect.stringContaining("finance artefact hidden"),
      expect.objectContaining({
        artifactCount: 1,
        messageId: "msg-flagged",
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
