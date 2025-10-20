import { describe, expect, it, vi } from "vitest";
import { formatISO } from "date-fns";
import * as logging from "@/lib/logging";
import type { StructuredLogEntry } from "@/lib/logging";

import { convertToModelMessages } from "@/lib/ai/messages/convert-to-model-messages";
import type { DBMessage } from "@/lib/db/schema";
import type {
  FinanceBacktestArtifact,
  FinanceChartArtifact,
  FinanceNewsArtifact,
} from "@/lib/finance/types";
import { convertToUIMessages } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

const buildChartArtifact = (): FinanceChartArtifact => ({
  type: "finance.chart",
  symbol: "AAPL",
  timeframe: "1D",
  range: { from: "2025-01-01", to: "2025-03-01" },
  ohlcv: [
    { t: 1_700_000_000, o: 170, h: 172, l: 168, c: 171, v: 1_000_000 },
  ],
  overlays: [],
});

const buildNewsArtifact = (): FinanceNewsArtifact => ({
  type: "finance.news",
  symbol: "AAPL",
  items: [
    {
      id: "news-aapl-smoke",
      symbol: "AAPL",
      source: "MockWire",
      title: "Le marché salue les résultats trimestriels",
      url: "https://example.com/aapl-news",
      summary: "Croissance à deux chiffres et guidance rassurante.",
      publishedAt: "2025-02-10T09:30:00Z",
      sentiment: "positive",
    },
  ],
});

const buildBacktestArtifact = (): FinanceBacktestArtifact => ({
  type: "finance.backtest",
  runId: "bt_001",
  symbol: "AAPL",
  timeframe: "1D",
  period: { from: "2024-01-01", to: "2024-12-31" },
  strategy: { type: "sma-crossover", params: { fastPeriod: 20, slowPeriod: 50 } },
  metrics: {
    totalReturn: 0.2,
    cagr: 0.18,
    maxDrawdown: 0.1,
    winRate: 0.55,
    averageWin: 0.03,
    averageLoss: -0.01,
    sharpe: 1.2,
    profitFactor: 1.8,
    trades: 24,
  },
  equityCurve: [{ t: 1_700_000_000, e: 110_000 }],
  trades: [
    {
      entryTimestamp: 1_700_000_000,
      exitTimestamp: 1_700_086_400,
      entryPrice: 170,
      exitPrice: 176,
      quantity: 10,
      grossPnl: 60,
      netPnl: 58,
    },
  ],
  commentary: "Croisement haussier confirmé après une consolidation de six semaines.",
});

describe("convertToUIMessages", () => {
  it("re-hydrates finance artefacts as UI data parts", () => {
    const createdAt = new Date("2025-02-15T10:00:00Z");
    const chart = buildChartArtifact();
    const news = buildNewsArtifact();

    const message: DBMessage = {
      id: "msg-1",
      chatId: "chat-1",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Voici les éléments demandés.",
        },
      ],
      attachments: [],
      artifacts: [
        { type: chart.type, payload: chart },
        { type: news.type, payload: news },
      ],
      createdAt,
    } as DBMessage;

    const [uiMessage] = convertToUIMessages([message]);

    expect(uiMessage.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "Voici les éléments demandés." }),
        expect.objectContaining({ type: "data-financeChart", data: chart }),
        expect.objectContaining({ type: "data-financeNews", data: news }),
      ])
    );
    expect(uiMessage.metadata.createdAt).toEqual(formatISO(createdAt));
  });

  it("évite de dupliquer les data parts finance déjà présentes", () => {
    const createdAt = new Date("2025-03-01T09:30:00Z");
    const backtest = buildBacktestArtifact();

    const message: DBMessage = {
      id: "msg-duplicate", 
      chatId: "chat-dup", 
      role: "assistant",
      parts: [
        { type: "text", text: "Résultats du backtest" },
        { type: "data-financeBacktest", data: backtest },
      ],
      attachments: [],
      artifacts: [{ type: backtest.type, payload: backtest }],
      createdAt,
    } as DBMessage;

    const [uiMessage] = convertToUIMessages([message]);

    const financeParts = uiMessage.parts.filter(
      (part) => part.type === "data-financeBacktest"
    );

    expect(financeParts).toHaveLength(1);
    expect(financeParts[0]).toEqual(
      expect.objectContaining({ data: backtest })
    );
  });

  it("remplace les placeholders transitoires par les artefacts persistés", () => {
    const createdAt = new Date("2025-03-02T12:00:00Z");
    const backtest = buildBacktestArtifact();

    const message: DBMessage = {
      id: "msg-transient",
      chatId: "chat-transient",
      role: "assistant",
      parts: [
        { type: "text", text: "Backtest terminé" },
        {
          type: "data-financeBacktest",
          data: backtest,
          transient: true,
        },
      ],
      attachments: [],
      artifacts: [{ type: backtest.type, payload: backtest }],
      createdAt,
    } as DBMessage;

    const [uiMessage] = convertToUIMessages([message]);

    const financeParts = uiMessage.parts.filter(
      (part) => part.type === "data-financeBacktest"
    );

    expect(financeParts).toHaveLength(1);
    expect(financeParts[0]).toEqual(
      expect.objectContaining({ data: backtest })
    );
    expect((financeParts[0] as { transient?: boolean }).transient).not.toBe(true);
  });

  it("ignore les artefacts finance invalides en loggant un avertissement", () => {
    const warnSpy = vi
      .spyOn(logging, "logWarning")
      .mockImplementation((context, message, extra) => ({
        context,
        level: "warn",
        message: typeof message === "string" ? message : undefined,
        timestamp: new Date().toISOString(),
        extra,
      }) satisfies StructuredLogEntry);
    const createdAt = new Date("2025-02-20T10:00:00Z");

    const malformedArtifact = {
      type: "finance.chart" as const,
      payload: {
        type: "finance.chart",
        symbol: "AAPL",
        timeframe: "1D",
        overlays: [],
      },
    };

    const message: DBMessage = {
      id: "msg-2",
      chatId: "chat-1",
      role: "assistant",
      parts: [],
      attachments: [],
      artifacts: [malformedArtifact],
      createdAt,
    } as DBMessage;

    const [uiMessage] = convertToUIMessages([message]);

    expect(uiMessage.parts).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "chat:convertToUIMessages",
      "[convertToUIMessages] skipped malformed finance artifact",
      expect.objectContaining({
        artifactType: "finance.chart",
        issues: expect.arrayContaining([expect.stringContaining("Required")]),
      })
    );

    warnSpy.mockRestore();
  });
});

describe("convertToModelMessages", () => {
  it("strips finance artefact data parts before delegating to the AI SDK", () => {
    const baseMessage: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Analyse en cours." },
        { type: "data-financeBacktest", data: buildBacktestArtifact() },
      ],
      metadata: { createdAt: new Date("2025-02-15T10:00:00Z").toISOString() },
    };

    const { id: _id, ...messageWithoutId } = baseMessage;

    const modelMessages = convertToModelMessages([messageWithoutId]);

    expect(modelMessages).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Analyse en cours.",
          },
        ],
      },
    ]);
  });
});
