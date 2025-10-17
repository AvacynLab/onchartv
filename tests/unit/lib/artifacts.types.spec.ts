import { describe, expect, it } from "vitest";

/**
 * Tests covering the discriminated union that shapes persisted finance
 * artefacts. Keeping the schema well defined is critical for deterministic
 * hydration in the chat UI and for guaranteeing that migrations remain
 * backwards compatible.
 */

import {
  financeMessageArtifactSchema,
  unwrapFinanceArtifact,
  wrapFinanceArtifact,
} from "@/lib/artifacts/types";
import {
  financeBacktestArtifactSchema,
  financeChartAnnotationsArtifactSchema,
  financeChartArtifactSchema,
  financeFundamentalsArtifactSchema,
  financeNewsArtifactSchema,
  financeScreenArtifactSchema,
} from "@/lib/finance/types";

describe("financeMessageArtifactSchema", () => {
  it("valide un artefact finance persistant complet", () => {
    const payload = financeChartArtifactSchema.parse({
      type: "finance.chart",
      symbol: "AAPL",
      timeframe: "1D",
      range: { from: "2024-01-01", to: "2024-02-01" },
      ohlcv: [
        {
          t: 1_704_889_600,
          o: 180,
          h: 184,
          l: 178,
          c: 182,
          v: 1_200_000,
        },
      ],
      overlays: [],
    });

    const parsed = financeMessageArtifactSchema.parse({
      type: payload.type,
      payload,
    });

    expect(parsed.payload.symbol).toBe("AAPL");
  });

  it("rejette un artefact dont le type ne correspond pas au payload", () => {
    const result = financeMessageArtifactSchema.safeParse({
      type: "finance.news",
      payload: {
        type: "finance.chart",
        symbol: "AAPL",
        timeframe: "1D",
        range: { from: "2024-01-01", to: "2024-02-01" },
        ohlcv: [],
        overlays: [],
      },
    });

    expect(result.success).toBe(false);
  });

  it("retourne null lorsque le wrapper ne correspond pas au schéma", () => {
    const payload = financeChartArtifactSchema.parse({
      type: "finance.chart",
      symbol: "NVDA",
      timeframe: "1H",
      range: { from: "2024-03-01", to: "2024-03-15" },
      ohlcv: [],
      overlays: [],
    });

    expect(
      unwrapFinanceArtifact({
        type: "finance.chart",
        payload,
      })
    ).toEqual(payload);

    expect(
      unwrapFinanceArtifact({
        type: "finance.chart",
        payload: { ...payload, symbol: undefined },
      } as unknown as Parameters<typeof unwrapFinanceArtifact>[0])
    ).toBeNull();
  });
});

describe("wrapFinanceArtifact", () => {
  it("conserve le discriminant et valide chaque type d'artefact", () => {
    const artefacts = [
      financeChartArtifactSchema.parse({
        type: "finance.chart",
        symbol: "AAPL",
        timeframe: "1D",
        range: { from: "2024-01-01", to: "2024-01-02" },
        ohlcv: [
          { t: 1_704_889_600, o: 180, h: 184, l: 178, c: 182, v: 1_200_000 },
        ],
        overlays: [],
      }),
      financeChartAnnotationsArtifactSchema.parse({
        type: "finance.chart.annotations",
        symbol: "AAPL",
        timeframe: "1D",
        patterns: [],
        levels: [],
      }),
      financeFundamentalsArtifactSchema.parse({
        type: "finance.fundamentals",
        symbol: "NVDA",
        snapshot: {
          symbol: "NVDA",
          marketCap: 1_000_000_000_000,
          peRatio: 25,
          dividendYield: 0.01,
          revenueTtm: 200_000_000_000,
          grossMargin: 0.7,
          netMargin: 0.25,
          debtToEquity: 0.4,
        },
        highlights: ["Record data center revenue"],
        caution: "Volatility remains elevated",
      }),
      financeNewsArtifactSchema.parse({
        type: "finance.news",
        symbol: "AAPL",
        items: [
          {
            id: "news-1",
            symbol: "AAPL",
            source: "Newswire",
            title: "Apple annonce de nouveaux Mac",
            url: "https://example.com/news/apple",
            summary: "Gamme M4 rafraîchie",
            publishedAt: "2024-05-01",
            sentiment: "positive",
          },
        ],
      }),
      financeBacktestArtifactSchema.parse({
        type: "finance.backtest",
        runId: "run-123",
        symbol: "AAPL",
        timeframe: "1D",
        period: { from: "2024-01-01", to: "2024-04-01" },
        strategy: {
          type: "sma-crossover",
          params: { fastPeriod: 10, slowPeriod: 30 },
        },
        metrics: {
          totalReturn: 0.12,
          cagr: 0.11,
          maxDrawdown: -0.05,
          winRate: 0.6,
          averageWin: 0.03,
          averageLoss: -0.01,
          sharpe: 1.8,
          profitFactor: 1.5,
          trades: 10,
        },
        equityCurve: [
          { t: 1_704_889_600, e: 100_000 },
          { t: 1_705_750_400, e: 103_000 },
        ],
        trades: [
          {
            entryTimestamp: 1_704_889_600,
            entryPrice: 180,
            exitTimestamp: 1_705_750_400,
            exitPrice: 190,
            quantity: 10,
            grossPnl: 100,
            netPnl: 95,
          },
        ],
        commentary: "Momentum aided by AI demand",
      }),
      financeScreenArtifactSchema.parse({
        type: "finance.screen",
        results: [
          { symbol: "BTCUSD", marketCap: 800_000_000_000, peRatio: 0 },
          { symbol: "ETHUSD", marketCap: 350_000_000_000, peRatio: 0 },
        ],
      }),
    ];

    for (const artefact of artefacts) {
      const wrapped = wrapFinanceArtifact(artefact);

      expect(wrapped.type).toBe(artefact.type);
      expect(wrapped.payload).toEqual(artefact);
      expect(financeMessageArtifactSchema.parse(wrapped).payload).toEqual(
        artefact
      );
    }
  });
});
