import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFinanceTools,
  financeToolSchemas,
} from "@/lib/ai/tools/finance";
import { InMemoryMarketDataAdapter } from "@/lib/finance/data-adapter";
import { FINANCE_SERIES } from "@/lib/finance/mock-data";
import { DEFAULT_FINANCE_PREFERENCES } from "@/lib/finance/preferences";
import type { FinanceArtifact } from "@/lib/finance/types";

const logger = { info: vi.fn() };

function createTestTools() {
  return createFinanceTools({
    marketData: new InMemoryMarketDataAdapter(FINANCE_SERIES),
    logger,
    idFactory: () => "bt-fixed",
    preferences: DEFAULT_FINANCE_PREFERENCES,
  });
}

describe("finance tools", () => {
  beforeEach(() => {
    logger.info.mockClear();
  });

  it("fetches chart data with overlays", async () => {
    const tools = createTestTools();

    const result = await tools.chartFetch.execute({
      symbol: "AAPL",
      timeframe: "1D",
      limit: 120,
      overlays: [
        { type: "sma", length: 20 },
        { type: "ema", length: 50 },
      ],
    });

    expect(result.type).toBe("finance.chart");
    expect(result.ohlcv).toHaveLength(120);
    expect(result.overlays).toHaveLength(2);
    expect(result.overlays[0]).toMatchObject({ type: "sma", length: 20 });
    expect(result.range.from).toMatch(/T/);
  });

  it("rejects chart requests exceeding the candle cap", () => {
    expect(() =>
      financeToolSchemas.chartFetch.parse({
        symbol: "AAPL",
        timeframe: "1D",
        limit: 2_000,
      })
    ).toThrow(/Cannot request more than/);
  });

  it("annotates chart data and returns detected structures", async () => {
    const tools = createTestTools();
    const base = await tools.chartFetch.execute({
      symbol: "NVDA",
      timeframe: "1D",
      limit: 200,
    });

    const annotations = await tools.chartAnnotate.execute({
      symbol: "NVDA",
      timeframe: "1D",
      candles: base.ohlcv,
    });

    expect(annotations.type).toBe("finance.chart.annotations");
    expect(Array.isArray(annotations.patterns)).toBe(true);
    expect(Array.isArray(annotations.levels)).toBe(true);
  });

  it("returns mocked fundamentals with highlights", async () => {
    const tools = createTestTools();

    const fundamentals = await tools.fundamentalsFetch.execute({
      symbol: "AAPL",
    });

    expect(fundamentals.type).toBe("finance.fundamentals");
    expect(fundamentals.snapshot.symbol).toBe("AAPL");
    expect(fundamentals.highlights.length).toBeGreaterThan(0);
  });

  it("fetches sentiment-tagged news respecting the limit", async () => {
    const tools = createTestTools();

    const news = await tools.newsFetch.execute({ symbol: "AAPL", limit: 1 });

    expect(news.type).toBe("finance.news");
    expect(news.items).toHaveLength(1);
    expect(news.items[0].symbol).toBe("AAPL");
  });

  it("omits headlines when user preferences disable news", async () => {
    const tools = createFinanceTools({
      marketData: new InMemoryMarketDataAdapter(FINANCE_SERIES),
      logger,
      preferences: { ...DEFAULT_FINANCE_PREFERENCES, showNews: false },
    });

    const news = await tools.newsFetch.execute({ symbol: "AAPL", limit: 3 });

    expect(news.type).toBe("finance.news");
    expect(news.items).toHaveLength(0);
  });

  it("runs the SMA backtest and returns deterministic metrics", async () => {
    const tools = createTestTools();

    const backtest = await tools.strategyBacktest.execute({
      symbol: "AAPL",
      timeframe: "1D",
      range: {
        from: "2024-01-01T00:00:00Z",
        to: "2025-01-01T00:00:00Z",
      },
      strategy: {
        type: "sma-crossover",
        params: {
          fastPeriod: 20,
          slowPeriod: 50,
        },
      },
      risk: {
        initialCapital: 100_000,
        commissionPerTrade: 1,
        slippageBps: 5,
      },
    });

    expect(backtest.type).toBe("finance.backtest");
    expect(backtest.runId).toBe("bt-fixed");
    expect(backtest.metrics.trades).toBeGreaterThanOrEqual(0);
    expect(backtest.equityCurve.length).toBeGreaterThan(0);
  });

  it("screens assets according to market cap filters", async () => {
    const tools = createTestTools();

    const screen = await tools.screenAssets.execute({
      filters: {
        minMarketCap: 1e12,
        assetTypes: ["equity"],
      },
    });

    expect(screen.type).toBe("finance.screen");
    expect(screen.results.every((entry) => entry.marketCap >= 1e12)).toBe(true);
  });

  it("emits artefacts through the callback when provided", async () => {
    const captured: FinanceArtifact[] = [];
    const tools = createFinanceTools({
      marketData: new InMemoryMarketDataAdapter(FINANCE_SERIES),
      logger,
      onArtifact: (artifact) => {
        captured.push(artifact);
      },
    });

    await tools.chartFetch.execute({ symbol: "AAPL" });
    await tools.strategyBacktest.execute({
      symbol: "AAPL",
      timeframe: "1D",
      range: {
        from: "2024-01-01T00:00:00Z",
        to: "2024-06-01T00:00:00Z",
      },
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 10, slowPeriod: 20 },
      },
      risk: { initialCapital: 10_000 },
    });

    expect(captured.some((artifact) => artifact.type === "finance.chart")).toBe(
      true
    );
    expect(
      captured.some((artifact) => artifact.type === "finance.backtest")
    ).toBe(true);
  });
});
