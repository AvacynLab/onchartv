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
      { timestamp: 1, open: 102, close: 98, high: 103, low: 97 },
      { timestamp: 2, open: 98, close: 99.4, high: 100, low: 95 }, // hammer
      { timestamp: 3, open: 99.5, close: 98.5, high: 100, low: 98 },
      { timestamp: 4, open: 98, close: 101.5, high: 102, low: 97.5 }, // bullish engulfing
      { timestamp: 5, open: 101.2, close: 102.4, high: 103, low: 100.8 },
      { timestamp: 6, open: 103, close: 100, high: 103.5, low: 99.5 }, // bearish engulfing
    ]);

    const patterns = detectCandlestickPatterns(candles);
    const names = patterns.map((pattern) => pattern.pattern.name);

    expect(names).toContain("hammer");
    expect(names).toContain("bullish_engulfing");
    expect(names).toContain("bearish_engulfing");
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
});
