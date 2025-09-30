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
});

describe("calculateRSI", () => {
  it("matches Wilder's RSI example for period 14", () => {
    const rsi = calculateRSI(SAMPLE_CLOSES, { period: 14 });

    expect(rsi[13]).toBeNull();
    expect(rsi[14]).toBeCloseTo(70.464, 3);
    expect(rsi[15]).toBeCloseTo(66.250, 3);
    expect(rsi[20]).toBeCloseTo(62.881, 3);
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
