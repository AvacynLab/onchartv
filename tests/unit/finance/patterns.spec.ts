import { describe, expect, it } from "vitest";

import {
  detectCandlestickPatterns,
  detectSupportResistanceLevels,
} from "../../../lib/finance/patterns";
import type { OHLCV } from "../../../lib/finance/types";

const BASE_TIMESTAMP = 1_700_100_000;

function candle(index: number, values: Partial<OHLCV>): OHLCV {
  return {
    timestamp: BASE_TIMESTAMP + index * 86_400,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000,
    ...values,
  };
}

describe("detectCandlestickPatterns", () => {
  it("identifies hammer patterns", () => {
    const candles: OHLCV[] = [
      candle(0, { open: 105, close: 103, high: 106, low: 102 }),
      candle(1, { open: 103, close: 101, high: 104, low: 100 }),
      candle(2, { open: 100.0, close: 100.5, high: 100.7, low: 98.6 }),
      candle(3, { open: 100.2, close: 101.6, high: 102, low: 99.8 }),
    ];

    const detections = detectCandlestickPatterns(candles);
    expect(detections.map((item) => item.pattern.name)).toContain("hammer");
  });

  it("identifies bullish engulfing setups", () => {
    const candles: OHLCV[] = [
      candle(0, { open: 100, close: 102, high: 102.5, low: 99.5 }),
      candle(1, { open: 101.8, close: 100.5, high: 102.0, low: 100.0 }),
      candle(2, { open: 100.4, close: 103.2, high: 103.5, low: 100.1 }),
    ];

    const detections = detectCandlestickPatterns(candles);
    expect(detections.map((item) => item.pattern.name)).toContain(
      "bullish_engulfing"
    );
  });

  it("identifies bearish engulfing setups", () => {
    const candles: OHLCV[] = [
      candle(0, { open: 100, close: 98.5, high: 100.3, low: 98.2 }),
      candle(1, { open: 98.7, close: 100.5, high: 101.0, low: 98.6 }),
      candle(2, { open: 100.8, close: 98.2, high: 101.1, low: 97.9 }),
    ];

    const detections = detectCandlestickPatterns(candles);
    expect(detections.map((item) => item.pattern.name)).toContain(
      "bearish_engulfing"
    );
  });
});

describe("detectSupportResistanceLevels", () => {
  it("groups nearby pivots into consolidated support/resistance levels", () => {
    const candles: OHLCV[] = [
      candle(0, { high: 110, low: 100, open: 108, close: 109 }),
      candle(1, { high: 112, low: 102, open: 110, close: 111 }),
      candle(2, { high: 114, low: 103, open: 113, close: 104 }),
      candle(3, { high: 113.8, low: 101.2, open: 102, close: 103 }),
      candle(4, { high: 114.2, low: 105, open: 112, close: 113 }),
      candle(5, { high: 115, low: 107, open: 114, close: 114.5 }),
      candle(6, { high: 116, low: 106, open: 115, close: 115.5 }),
    ];

    const levels = detectSupportResistanceLevels(candles, {
      lookback: 1,
      tolerance: 0.01,
    });

    const supportLevels = levels.filter((level) => level.type === "support");
    const resistanceLevels = levels.filter((level) => level.type === "resistance");

    expect(supportLevels.length).toBeGreaterThan(0);
    expect(resistanceLevels.length).toBeGreaterThan(0);

    const firstSupport = supportLevels[0];
    expect(firstSupport.price).toBeGreaterThan(100);
    expect(firstSupport.price).toBeLessThan(108);
  });
});
