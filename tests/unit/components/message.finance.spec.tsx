import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ChatMessage } from "@/lib/types";
import type { ArtifactRendererProps } from "@/components/ArtifactRenderer";
import type { FinanceBacktestArtifact } from "@/lib/finance/types";
import { wrapFinanceArtifact } from "@/lib/artifacts/types";

vi.mock("katex/dist/katex.min.css", () => ({}), { virtual: true });
vi.mock("server-only", () => ({}), { virtual: true });
vi.mock(
  "streamdown",
  () => ({
    Streamdown: ({
      children,
    }: {
      children?: React.ReactNode;
    }): React.ReactNode => children ?? null,
  }),
  { virtual: true }
);

const artifactRendererSpy = vi.fn(
  (props: ArtifactRendererProps) => (
    <div data-artifact-type={props.artifact.type} data-testid="artifact-renderer-mock" />
  )
);

vi.mock("@/components/ArtifactRenderer", () => ({
  ArtifactRenderer: (props: ArtifactRendererProps) => artifactRendererSpy(props),
}));

const { DataStreamProvider } = await import("@/components/data-stream-provider");
const { PreviewMessage } = await import("@/components/message");

const noop = () => {};

function createFinanceToolMessage(): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    metadata: { createdAt: new Date().toISOString() },
    parts: [
      {
        id: "text-1",
        type: "text",
        text: "Finance artefact preview",
      },
      {
        type: "tool-tool.finance.chart.fetch",
        toolCallId: "tool-call-1",
        state: "input-available",
        input: { symbol: "AAPL", timeframe: "1D" },
        output: undefined,
        errorText: undefined,
      },
    ],
    artifacts: [],
    attachments: [],
  } as unknown as ChatMessage;
}

describe("PreviewMessage finance feature flag", () => {
  beforeAll(() => {
    (globalThis as unknown as { React: typeof React }).React = React;
    class ResizeObserverMock implements ResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(_target: Element, _options?: ResizeObserverOptions) {
        this.callback([], this as unknown as ResizeObserver);
      }

      unobserve(_target: Element) {}
      disconnect() {}
      takeRecords(): ResizeObserverEntry[] {
        return [];
      }
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    artifactRendererSpy.mockClear();
  });

  it("omits finance tools when the feature flag is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "false");

    render(
      <DataStreamProvider>
        <PreviewMessage
          chatId="chat-42"
          isLoading={false}
          isReadonly={true}
          message={createFinanceToolMessage()}
          regenerate={noop as any}
          requiresScrollPadding={false}
          setMessages={noop as any}
          vote={undefined}
        />
      </DataStreamProvider>
    );

    expect(
      screen.queryByText("tool.finance.chart.fetch", {
        exact: false,
      })
    ).not.toBeInTheDocument();
  });

  it("renders finance tools when the feature flag is enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");

    render(
      <DataStreamProvider>
        <PreviewMessage
          chatId="chat-42"
          isLoading={false}
          isReadonly={true}
          message={createFinanceToolMessage()}
          regenerate={noop as any}
          requiresScrollPadding={false}
          setMessages={noop as any}
          vote={undefined}
        />
      </DataStreamProvider>
    );

    expect(
      screen.getByText("tool.finance.chart.fetch", {
        exact: false,
      })
    ).toBeInTheDocument();
  });

  it("render les artefacts finance persistés lorsqu'ils sont disponibles", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");

    const backtestArtifact: FinanceBacktestArtifact = {
      type: "finance.backtest",
      runId: "run-1",
      symbol: "AAPL",
      timeframe: "1D",
      period: { from: "2018-01-01", to: "2020-12-31" },
      strategy: { type: "sma-crossover", params: { fastPeriod: 50, slowPeriod: 200 } },
      metrics: {
        totalReturn: 0.2,
        cagr: 0.1,
        maxDrawdown: 0.05,
        winRate: 0.6,
        averageWin: 1500,
        averageLoss: -500,
        sharpe: 1.2,
        profitFactor: 2.5,
        trades: 4,
      },
      equityCurve: [{ t: 1514764800, e: 10_000 }],
      trades: [
        {
          entryTimestamp: 1514764800,
          entryPrice: 150,
          exitTimestamp: 1517443200,
          exitPrice: 165,
          quantity: 10,
          grossPnl: 150,
          netPnl: 145,
        },
      ],
      commentary: "Sample backtest",
    };

    const persistedMessage = {
      id: "assistant-artefact-1",
      role: "assistant",
      metadata: { createdAt: new Date().toISOString() },
      parts: [
        { id: "text-1", type: "text", text: "Backtest terminé" },
        { type: "data-financeBacktest", data: backtestArtifact },
      ],
    } as unknown as ChatMessage;

    render(
      <DataStreamProvider>
        <PreviewMessage
          chatId="chat-42"
          isLoading={false}
          isReadonly={true}
          message={persistedMessage}
          regenerate={noop as any}
          requiresScrollPadding={false}
          setMessages={noop as any}
          vote={undefined}
        />
      </DataStreamProvider>
    );

    expect(screen.getByTestId("artifact-renderer-mock")).toBeInTheDocument();
    expect(artifactRendererSpy).toHaveBeenCalledWith(
      expect.objectContaining({ artifact: backtestArtifact })
    );
  });

  it("fallback sur message.artifacts persistés (wrappés) lorsque les data parts sont absentes", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");

    const backtestArtifact: FinanceBacktestArtifact = {
      type: "finance.backtest",
      runId: "run-2",
      symbol: "AAPL",
      timeframe: "1D",
      period: { from: "2019-01-01", to: "2019-12-31" },
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 50, slowPeriod: 200 },
      },
      metrics: {
        totalReturn: 0.12,
        cagr: 0.08,
        maxDrawdown: 0.03,
        winRate: 0.55,
        averageWin: 800,
        averageLoss: -300,
        sharpe: 1.1,
        profitFactor: 1.8,
        trades: 6,
      },
      equityCurve: [{ t: 1546300800, e: 110_000 }],
      trades: [
        {
          entryTimestamp: 1546300800,
          entryPrice: 140,
          exitTimestamp: 1548892800,
          exitPrice: 150,
          quantity: 5,
          grossPnl: 50,
          netPnl: 48,
        },
      ],
      commentary: "Streaming backtest output",
    };

    const streamingMessage = {
      id: "assistant-artefact-stream",
      role: "assistant",
      metadata: { createdAt: new Date().toISOString() },
      parts: [
        { id: "text-1", type: "text", text: "Résultats du backtest" },
      ],
      artifacts: [wrapFinanceArtifact(backtestArtifact)],
    } as unknown as ChatMessage;

    render(
      <DataStreamProvider>
        <PreviewMessage
          chatId="chat-99"
          isLoading={false}
          isReadonly={true}
          message={streamingMessage}
          regenerate={noop as any}
          requiresScrollPadding={false}
          setMessages={noop as any}
          vote={undefined}
        />
      </DataStreamProvider>
    );

    expect(screen.getByTestId("artifact-renderer-mock")).toBeInTheDocument();
    expect(artifactRendererSpy).toHaveBeenCalledWith(
      expect.objectContaining({ artifact: backtestArtifact })
    );
  });

  it("supporte les artefacts legacy non wrappés pour les anciennes conversations", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");

    const backtestArtifact: FinanceBacktestArtifact = {
      type: "finance.backtest",
      runId: "run-legacy",
      symbol: "NVDA",
      timeframe: "1D",
      period: { from: "2017-01-01", to: "2018-12-31" },
      strategy: { type: "sma-crossover", params: { fastPeriod: 20, slowPeriod: 50 } },
      metrics: {
        totalReturn: 0.32,
        cagr: 0.14,
        maxDrawdown: 0.09,
        winRate: 0.58,
        averageWin: 900,
        averageLoss: -450,
        sharpe: 1.4,
        profitFactor: 1.9,
        trades: 7,
      },
      equityCurve: [{ t: 1483228800, e: 12_000 }],
      trades: [
        {
          entryTimestamp: 1483228800,
          entryPrice: 100,
          exitTimestamp: 1485907200,
          exitPrice: 112,
          quantity: 12,
          grossPnl: 144,
          netPnl: 138,
        },
      ],
      commentary: "Legacy artifact payload",
    };

    const legacyMessage = {
      id: "assistant-legacy-artifact",
      role: "assistant",
      metadata: { createdAt: new Date().toISOString() },
      parts: [
        { id: "text-1", type: "text", text: "Backtest historique" },
      ],
      artifacts: [backtestArtifact],
    } as unknown as ChatMessage;

    render(
      <DataStreamProvider>
        <PreviewMessage
          chatId="chat-legacy"
          isLoading={false}
          isReadonly={true}
          message={legacyMessage}
          regenerate={noop as any}
          requiresScrollPadding={false}
          setMessages={noop as any}
          vote={undefined}
        />
      </DataStreamProvider>
    );

    expect(screen.getByTestId("artifact-renderer-mock")).toBeInTheDocument();
    expect(artifactRendererSpy).toHaveBeenCalledWith(
      expect.objectContaining({ artifact: backtestArtifact })
    );
  });
});
