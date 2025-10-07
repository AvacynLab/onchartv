import { describe, expect, it } from "vitest";

import { runBacktest } from "@/lib/finance/backtest/engine";
import type { BacktestParameters, OHLCV } from "@/lib/finance/types";

/**
 * Utility producing deterministic candles so the tests stay readable. The body
 * intentionally mirrors lightweight historical data (open/high/low/close
 * structure) but keeps the volume constant since the engine does not use it.
 */
function candle(
  timestamp: number,
  close: number,
  overrides: Partial<OHLCV> = {}
): OHLCV {
  const base = {
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  } satisfies OHLCV;

  return { ...base, ...overrides };
}

const BASE_PARAMETERS: BacktestParameters = {
  strategy: {
    type: "sma-crossover",
    params: { fastPeriod: 1, slowPeriod: 2 },
  },
  risk: {
    initialCapital: 10_000,
    quantity: 1,
    commissionPerTrade: 15,
    slippageBps: 25,
  },
};

describe("runBacktest", () => {
  it("returns default metrics when provided an empty dataset", () => {
    const result = runBacktest([], BASE_PARAMETERS);

    expect(result.trades).toEqual([]);
    expect(result.equityCurve).toEqual([]);
    expect(result.metrics).toEqual({
      totalReturn: 0,
      cagr: 0,
      maxDrawdown: 0,
      winRate: 0,
      averageWin: 0,
      averageLoss: 0,
      sharpe: 0,
      profitFactor: 0,
      trades: 0,
    });
  });

  it("returns a flat equity curve and zeroed metrics when no trades trigger", () => {
    const candles: OHLCV[] = [
      candle(1, 100),
      candle(2, 100),
      candle(3, 100),
      candle(4, 100),
      candle(5, 100),
      candle(6, 100),
    ];

    const result = runBacktest(candles, BASE_PARAMETERS);

    expect(result.trades).toHaveLength(0);
    expect(result.metrics.trades).toBe(0);
    expect(result.metrics.winRate).toBe(0);
    expect(result.metrics.totalReturn).toBe(0);
    expect(result.metrics.profitFactor).toBe(0);
    expect(result.metrics.maxDrawdown).toBe(0);

    for (const point of result.equityCurve) {
      expect(point.equity).toBe(BASE_PARAMETERS.risk.initialCapital);
    }
  });

  it("applies commissions and slippage when trades are executed", () => {
    // The sequence purposely trends lower before reversing so the SMA crossover
    // strategy opens a position and later exits it once momentum fades.
    const candles: OHLCV[] = [
      candle(1, 105, { high: 106, low: 104 }),
      candle(2, 104, { high: 105, low: 103 }),
      candle(3, 103, { high: 104, low: 102 }),
      candle(4, 102, { high: 103, low: 101 }),
      candle(5, 103, { high: 104, low: 102 }),
      candle(6, 104, { high: 105, low: 103 }),
      candle(7, 105, { high: 106, low: 104 }),
      candle(8, 104, { high: 105, low: 103 }),
      candle(9, 103, { high: 104, low: 102 }),
    ];

    const result = runBacktest(candles, BASE_PARAMETERS);

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];

    const entryCandle = candles.find((item) => item.timestamp === trade.entryTimestamp);
    const exitCandle = candles.find((item) => item.timestamp === trade.exitTimestamp);
    expect(entryCandle).toBeDefined();
    expect(exitCandle).toBeDefined();

    // Slippage should make the filled buy price higher than the candle close.
    expect(trade.entryPrice).toBeGreaterThan((entryCandle as OHLCV).close);
    // Symmetrically the sell should execute slightly below the raw close.
    expect(trade.exitPrice).toBeLessThan((exitCandle as OHLCV).close);

    // Commissions are charged on entry and exit, shrinking the net PnL.
    expect(trade.netPnl).toBeLessThan(trade.grossPnl);
    expect(result.metrics.trades).toBe(result.trades.length);
  });

  it("handles oversized moving average windows by staying flat", () => {
    /**
     * Keep the market structure intentionally short so the slow MA never
     * receives enough samples to emit non-null values. This mirrors the
     * boundary condition hit when the assistant asks for a 200-period overlay
     * on a dataset that only spans a few sessions.
     */
    const candles: OHLCV[] = [
      candle(1, 100),
      candle(2, 101),
      candle(3, 102),
      candle(4, 103),
      candle(5, 104),
    ];

    const result = runBacktest(candles, {
      ...BASE_PARAMETERS,
      strategy: {
        type: "sma-crossover",
        params: { fastPeriod: 5, slowPeriod: 25 },
      },
    });

    expect(result.trades).toHaveLength(0);
    expect(result.metrics.trades).toBe(0);
    expect(result.metrics.winRate).toBe(0);
    expect(result.metrics.totalReturn).toBe(0);
    expect(result.metrics.maxDrawdown).toBe(0);
    expect(result.equityCurve).toHaveLength(candles.length);
    expect(
      result.equityCurve.every(
        (point) => point.equity === BASE_PARAMETERS.risk.initialCapital
      )
    ).toBe(true);
  });

  it("degrades performance gracefully under extreme fees and slippage", () => {
    /**
     * The price path trends strongly higher so the crossover opens a long
     * position. We then crank fees/slippage to stress the arithmetic and ensure
     * metrics remain finite instead of exploding to +/-Infinity.
     */
    const candles: OHLCV[] = [
      candle(1, 100),
      candle(2, 102),
      candle(3, 104),
      candle(4, 106),
      candle(5, 108),
      candle(6, 110),
      candle(7, 111),
      candle(8, 112),
      candle(9, 114),
      candle(10, 116),
    ];

    const result = runBacktest(candles, {
      ...BASE_PARAMETERS,
      risk: {
        initialCapital: 10_000,
        quantity: 10,
        commissionPerTrade: 500,
        slippageBps: 250,
      },
    });

    expect(result.trades.length).toBeGreaterThan(0);
    const metrics = result.metrics;

    expect(Number.isFinite(metrics.totalReturn)).toBe(true);
    expect(Number.isFinite(metrics.cagr)).toBe(true);
    expect(Number.isFinite(metrics.maxDrawdown)).toBe(true);
    expect(Number.isFinite(metrics.profitFactor)).toBe(true);
    expect(Number.isFinite(metrics.sharpe)).toBe(true);

    const tradePnls = result.trades.map((trade) => trade.netPnl);
    expect(tradePnls.every((value) => Number.isFinite(value))).toBe(true);
  });
});
