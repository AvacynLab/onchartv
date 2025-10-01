import { describe, expect, it } from "vitest";

import {
  calculateBollingerBands,
  calculateEMA,
  calculateRSI,
  calculateSMA,
} from "../../../lib/finance/indicators";
import type { OHLCV } from "../../../lib/finance/types";

const SAMPLE_CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
  46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21,
];

const SAMPLE_CANDLES: OHLCV[] = SAMPLE_CLOSES.map((close, index) => ({
  timestamp: 1_700_000_000 + index * 86_400,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1_000 + index * 10,
}));

describe("calculateSMA", () => {
  it("returns nulls until the window is populated and then rolling averages", () => {
    const sma = calculateSMA(SAMPLE_CLOSES, { period: 5 });

    expect(sma.slice(0, 4)).toEqual([null, null, null, null]);
    expect(sma[4]).toBeCloseTo(44.104, 3);
    expect(sma[5]).toBeCloseTo(44.202, 3);
    expect(sma[6]).toBeCloseTo(44.404, 3);
  });

  it("throws when the period is invalid", () => {
    expect(() => calculateSMA(SAMPLE_CLOSES, { period: 0 })).toThrowError(
      /positive integer/
    );
  });
});

describe("calculateEMA", () => {
  it("aligns the first defined value with the SMA and smooths subsequent points", () => {
    const ema = calculateEMA(SAMPLE_CLOSES, { period: 5 });

    expect(ema[4]).toBeCloseTo(44.104, 3);
    expect(ema[5]).toBeCloseTo(44.346, 3);
    expect(ema[6]).toBeCloseTo(44.597, 3);
  });

  it("returns a flat series when prices are constant", () => {
    const closes = new Array(20).fill(150);
    const ema = calculateEMA(closes, { period: 5 });

    // First defined value should equal the underlying SMA and remain constant afterwards.
    expect(ema[4]).toBe(150);
    expect(ema.slice(4).every((value) => value === 150)).toBe(true);
  });

  it("dampens oscillations compared to the underlying price series", () => {
    const zigZag = [100, 110, 90, 112, 88, 115, 85, 118, 82, 120];
    const ema = calculateEMA(zigZag, { period: 3 });

    const priceRange = Math.max(...zigZag) - Math.min(...zigZag);
    const emaRange =
      Math.max(...ema.filter((value): value is number => value !== null)) -
      Math.min(...ema.filter((value): value is number => value !== null));

    expect(emaRange).toBeLessThan(priceRange);
  });
});

describe("calculateRSI", () => {
  it("matches Wilder's RSI example for period 14", () => {
    const rsi = calculateRSI(SAMPLE_CLOSES, { period: 14 });

    expect(rsi[13]).toBeNull();
    expect(rsi[14]).toBeCloseTo(70.464, 3);
    expect(rsi[15]).toBeCloseTo(66.250, 3);
    expect(rsi[20]).toBeCloseTo(62.881, 3);
  });

  it("clips values to the [0, 100] interval on extreme moves", () => {
    const relentlessRally = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const waterfall = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

    const bullish = calculateRSI(relentlessRally, { period: 5 });
    const bearish = calculateRSI(waterfall, { period: 5 });

    const bullishValues = bullish.filter((value): value is number => value !== null);
    const bearishValues = bearish.filter((value): value is number => value !== null);

    expect(bullishValues.every((value) => value <= 100 && value >= 0)).toBe(true);
    expect(bearishValues.every((value) => value <= 100 && value >= 0)).toBe(true);
    expect(Math.max(...bullishValues)).toBe(100);
    expect(Math.min(...bearishValues)).toBe(0);
  });
});

describe("calculateBollingerBands", () => {
  it("computes middle/upper/lower bands with the provided deviation multiplier", () => {
    const bands = calculateBollingerBands(SAMPLE_CANDLES, {
      period: 5,
      standardDeviations: 2,
    });

    expect(bands[3]).toEqual({
      timestamp: SAMPLE_CANDLES[3].timestamp,
      middle: null,
      upper: null,
      lower: null,
    });

    const band = bands[5];
    expect(band.middle).toBeCloseTo(44.202, 3);
    expect(band.upper).toBeCloseTo(44.990, 3);
    expect(band.lower).toBeCloseTo(43.414, 3);
  });

  it("validates the deviation multiplier", () => {
    expect(() =>
      calculateBollingerBands(SAMPLE_CANDLES, {
        period: 5,
        standardDeviations: 0,
      })
    ).toThrowError(/Standard deviation multiplier/);
  });
});
