import { describe, expect, it } from "vitest";

import { runBacktest } from "../../../lib/finance/backtest/engine";
import { generateMockSeries } from "../../../lib/finance/data-adapter";
import type { BacktestParameters } from "../../../lib/finance/types";

const START = 1_700_000_000;

describe("runBacktest", () => {
  it("executes an SMA crossover strategy and returns deterministic metrics", () => {
    const candles = generateMockSeries({
      startTimestamp: START,
      candles: 60,
      basePrice: 100,
      amplitude: 3,
      trendPerCandle: 0.2,
    });

    const parameters: BacktestParameters = {
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 5, slowPeriod: 12 },
      },
      risk: {
        initialCapital: 10_000,
        commissionPerTrade: 1,
        slippageBps: 5,
      },
    };

    const result = runBacktest(candles, parameters);

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.equityCurve).toHaveLength(candles.length);
    expect(result.metrics.totalReturn).toBeGreaterThan(0);
    expect(result.metrics.maxDrawdown).toBeGreaterThan(0);

    const [firstTrade] = result.trades;
    expect(firstTrade.entryTimestamp).toBeGreaterThan(START);
    expect(firstTrade.exitTimestamp).toBeGreaterThan(firstTrade.entryTimestamp);
    expect(firstTrade.quantity).toBeGreaterThan(0);

    expect(result.metrics.winRate).toBeGreaterThan(0);
    expect(result.metrics.sharpe).toBeGreaterThan(0);
    expect(result.metrics.trades).toEqual(result.trades.length);
  });

  it("returns zeroed metrics when the dataset is empty", () => {
    const emptyResult = runBacktest([], {
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 5, slowPeriod: 12 },
      },
      risk: {
        initialCapital: 5_000,
      },
    });

    expect(emptyResult.trades).toEqual([]);
    expect(emptyResult.equityCurve).toEqual([]);
    expect(emptyResult.metrics.totalReturn).toBe(0);
    expect(emptyResult.metrics.trades).toBe(0);
  });
});
