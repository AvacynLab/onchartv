import { describe, expect, it } from "vitest";

import {
  detectCandlestickPatterns,
  detectSupportResistanceLevels,
} from "@/lib/finance/patterns";
import type { CandleSeries } from "@/lib/finance/types";

/**
 * Builds a minimal candle series for the pattern helpers. The defaults keep the
 * structures realistic while letting each test tweak only the relevant fields.
 */
function buildCandles(values: Array<Partial<CandleSeries[number]> & { timestamp: number }>): CandleSeries {
  return values.map((value) => ({
    open: value.open ?? value.close ?? 0,
    close: value.close ?? value.open ?? 0,
    high: value.high ?? Math.max(value.open ?? 0, value.close ?? 0),
    low: value.low ?? Math.min(value.open ?? 0, value.close ?? 0),
    volume: value.volume ?? 1_000,
    timestamp: value.timestamp,
  }));
}

describe("detectCandlestickPatterns", () => {
  it("ignores noisy sequences without clear patterns", () => {
    const candles = buildCandles([
      { timestamp: 1, open: 100, close: 100.5, high: 101, low: 99.5 },
      { timestamp: 2, open: 100.4, close: 100.1, high: 100.8, low: 99.9 },
      { timestamp: 3, open: 100.2, close: 100.3, high: 100.6, low: 100 },
      { timestamp: 4, open: 100.5, close: 100.45, high: 100.7, low: 100.2 },
    ]);

    expect(detectCandlestickPatterns(candles)).toEqual([]);
  });

  it("detects textbook hammer and engulfing setups", () => {
    const candles = buildCandles([
      { timestamp: 1, open: 110, close: 106, high: 111, low: 105 },
      { timestamp: 2, open: 106, close: 102, high: 107, low: 101 },
      { timestamp: 3, open: 102, close: 99, high: 103, low: 98 },
      { timestamp: 4, open: 98, close: 100, high: 101, low: 94 }, // hammer
      { timestamp: 5, open: 100.5, close: 98.2, high: 101, low: 97.5 },
      { timestamp: 6, open: 97.8, close: 101.8, high: 102.5, low: 97.2 }, // bullish engulfing
      { timestamp: 7, open: 101.5, close: 104, high: 104.6, low: 101 },
      { timestamp: 8, open: 104, close: 105.8, high: 106.3, low: 103.5 },
      { timestamp: 9, open: 106.2, close: 101.9, high: 106.6, low: 101.4 }, // bearish engulfing
    ]);

    const patterns = detectCandlestickPatterns(candles);
    const names = patterns.map((pattern) => pattern.pattern.name);

    expect(names).toContain("hammer");
    expect(names).toContain("bullish_engulfing");
    expect(names).toContain("bearish_engulfing");
  });

  it("skips reversal patterns when the prerequisite trend is absent", () => {
    const candles = buildCandles([
      { timestamp: 1, open: 100, close: 100.5, high: 101, low: 99.5 },
      { timestamp: 2, open: 100.6, close: 100.8, high: 101.2, low: 100.4 },
      { timestamp: 3, open: 100.7, close: 100.9, high: 101.3, low: 100.5 },
      { timestamp: 4, open: 100.4, close: 100.9, high: 101.1, low: 99.4 }, // hammer body but no downtrend
      { timestamp: 5, open: 100.8, close: 101.1, high: 101.5, low: 100.6 },
    ]);

    const names = detectCandlestickPatterns(candles).map(
      (pattern) => pattern.pattern.name
    );

    expect(names).not.toContain("hammer");
    expect(names).toHaveLength(0);
  });
});

describe("detectSupportResistanceLevels", () => {
  it("returns empty levels when the series is shorter than the configured lookback", () => {
    const candles = buildCandles([
      { timestamp: 1, open: 100, close: 100 },
      { timestamp: 2, open: 100, close: 100 },
      { timestamp: 3, open: 100, close: 100 },
    ]);

    expect(detectSupportResistanceLevels(candles, { lookback: 2 })).toEqual([]);
  });

  it("detects well-defined support and resistance zones", () => {
    // This sequence has a pronounced sell-off (index 2) followed by a strong
    // rally (index 5). The lows/highs were crafted to exceed their neighbours so
    // the helper flags them as pivot points when `lookback` equals 2.
    const candles = buildCandles([
      { timestamp: 1, open: 101, close: 104, low: 101, high: 106 },
      { timestamp: 2, open: 104, close: 108, low: 103, high: 110 },
      { timestamp: 3, open: 108, close: 102, low: 95, high: 109 },
      { timestamp: 4, open: 103, close: 111, low: 104, high: 113 },
      { timestamp: 5, open: 110, close: 118, low: 105, high: 120 },
      { timestamp: 6, open: 118, close: 112, low: 107, high: 115 },
      { timestamp: 7, open: 111, close: 109, low: 104, high: 112 },
    ]);

    const levels = detectSupportResistanceLevels(candles, { lookback: 2 });

    expect(levels).toHaveLength(2);
    const support = levels.find((level) => level.type === "support");
    const resistance = levels.find((level) => level.type === "resistance");

    expect(support).toBeDefined();
    expect(support).toMatchObject({
      type: "support",
      price: 95,
      fromTimestamp: candles[0].timestamp,
      toTimestamp: candles[4].timestamp,
    });

    expect(resistance).toBeDefined();
    expect(resistance).toMatchObject({
      type: "resistance",
      price: 120,
      fromTimestamp: candles[2].timestamp,
      toTimestamp: candles[6].timestamp,
    });
  });

  it("merges nearby levels within the configured tolerance", () => {
    // The lows at indices 2 and 4 are separated by roughly 1 %, which sits
    // within the relaxed tolerance specified below. The expectation is that the
    // helper groups them together and averages the price.
    const candles = buildCandles([
      { timestamp: 1, open: 100, close: 103, low: 100, high: 104 },
      { timestamp: 2, open: 103, close: 105, low: 102, high: 106 },
      { timestamp: 3, open: 105, close: 99, low: 94.5, high: 106 },
      { timestamp: 4, open: 100, close: 108, low: 102, high: 110 },
      { timestamp: 5, open: 108, close: 102, low: 95.5, high: 111 },
      { timestamp: 6, open: 103, close: 107, low: 102, high: 109 },
      { timestamp: 7, open: 107, close: 104, low: 103, high: 108 },
    ]);

    const levels = detectSupportResistanceLevels(candles, {
      lookback: 1,
      tolerance: 0.015,
    });

    const supports = levels.filter((level) => level.type === "support");

    expect(supports).toHaveLength(1);
    expect(supports[0]).toMatchObject({
      type: "support",
      fromTimestamp: candles[1].timestamp,
      toTimestamp: candles[5].timestamp,
    });
    expect(supports[0].price).toBeCloseTo((94.5 + 95.5) / 2, 5);
  });
});
