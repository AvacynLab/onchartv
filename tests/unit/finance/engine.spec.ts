import { describe, expect, it } from "vitest";

import { runBacktest } from "../../../lib/finance/backtest/engine";
import { generateMockSeries } from "../../../lib/finance/data-adapter";
import type { BacktestParameters } from "../../../lib/finance/types";
import { FINANCE_SERIES } from "../../../lib/finance/mock-data";

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
    expect(emptyResult.metrics).toMatchObject({
      totalReturn: 0,
      cagr: 0,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: 0,
      trades: 0,
    });
  });

  it("stays fully invested in cash when the series is shorter than the slow period", () => {
    // Short synthetic sample (10 candles) while requesting a very slow moving average (50 periods).
    const candles = generateMockSeries({
      startTimestamp: START,
      candles: 10,
      basePrice: 200,
      amplitude: 0.1,
    });

    const result = runBacktest(candles, {
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 5, slowPeriod: 50 },
      },
      risk: {
        initialCapital: 25_000,
        commissionPerTrade: 2,
      },
    });

    expect(result.trades).toEqual([]);
    expect(result.equityCurve).toHaveLength(candles.length);
    expect(result.metrics).toMatchObject({
      trades: 0,
      totalReturn: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdown: 0,
    });
  });

  it("incorporates slippage and commissions when settling trades", () => {
    // Generate a two-phase series: an initial downtrend keeps the fast MA below the slow MA,
    // then a sustained uptrend forces a crossover so the strategy opens and closes positions.
    const downward = generateMockSeries({
      startTimestamp: START,
      candles: 60,
      basePrice: 200,
      trendPerCandle: -0.5,
      amplitude: 1.5,
    });
    const lastDownCandle = downward[downward.length - 1];
    expect(lastDownCandle).toBeDefined();
    const upward = generateMockSeries({
      startTimestamp: (lastDownCandle?.timestamp ?? START) + 86_400,
      candles: 120,
      // Anchor the new sine wave around the last downward close to avoid price gaps that
      // could otherwise skew the indicator crossover behaviour.
      basePrice: lastDownCandle?.close ?? 150,
      trendPerCandle: 0.8,
      amplitude: 1.2,
    });
    const candles = [...downward, ...upward].map((candle, index) => ({
      ...candle,
      // Re-normalise timestamps so indicators observe a continuous series.
      timestamp: START + index * 86_400,
    }));

    const baseParameters: BacktestParameters = {
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 10, slowPeriod: 30 },
      },
      risk: {
        initialCapital: 50_000,
        commissionPerTrade: 0,
        slippageBps: 0,
      },
    };

    const baseline = runBacktest(candles, baseParameters);
    const penalised = runBacktest(candles, {
      ...baseParameters,
      risk: {
        ...baseParameters.risk,
        commissionPerTrade: 25,
        slippageBps: 75,
      },
    });

    expect(penalised.trades.length).toBeGreaterThan(0);
    expect(penalised.trades.length).toBe(baseline.trades.length);

    for (const trade of penalised.trades) {
      // Each trade must account for execution costs and therefore net < gross.
      expect(trade.netPnl).toBeLessThanOrEqual(trade.grossPnl);
    }

    expect(penalised.metrics.totalReturn).toBeLessThan(
      baseline.metrics.totalReturn
    );
    expect(penalised.metrics.profitFactor).toBeLessThanOrEqual(
      baseline.metrics.profitFactor
    );
  });

  it("keeps the canonical AAPL backtest deterministic across the e2e window", () => {
    /**
     * Les scénarios Playwright demandent un backtest SMA(50/200) sur AAPL entre
     * 2018 et 2020. Ce test garantit que la série synthétique conserve un
     * journal multi-pages pour les contrôles d'accessibilité et que les
     * métriques exposées (rendement, CAGR, win rate) restent stables malgré les
     * ajustements apportés au générateur.
     */
    const candles = FINANCE_SERIES.AAPL.filter(
      (candle) =>
        candle.timestamp >= Date.UTC(2018, 0, 1) / 1000 &&
        candle.timestamp <= Date.UTC(2020, 11, 31) / 1000
    );

    const result = runBacktest(candles, {
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 50, slowPeriod: 200 },
      },
      risk: { initialCapital: 10_000 },
    });

    expect(result.trades.length).toBeGreaterThan(8);
    expect(result.metrics.totalReturn).toBeLessThan(0);
    expect(result.metrics.cagr).toBeLessThan(0);
    expect(result.metrics.winRate).toBe(0);
  });
});
