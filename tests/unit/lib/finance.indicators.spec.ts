import { describe, expect, it } from "vitest";

import {
  calculateEMA,
  calculateRSI,
} from "@/lib/finance/indicators";

/**
 * Short helper to build a list of closing prices. Wrapping the creation keeps
 * the expectations easy to read inside the assertions below.
 */
function series(values: number[]): number[] {
  return values;
}

describe("calculateEMA", () => {
  it("returns null values until the window is populated", () => {
    const result = calculateEMA(series([10, 11]), { period: 5 });
    expect(result).toEqual([null, null]);
  });

  it("remains stable on constant input", () => {
    const result = calculateEMA(series([50, 50, 50, 50, 50, 50]), { period: 3 });
    expect(result.filter((value) => value !== null)).toEqual([50, 50, 50, 50]);
  });

  it("short-circuits when the price series is empty", () => {
    expect(calculateEMA(series([]), { period: 3 })).toEqual([]);
  });

  it("throws when provided an invalid period", () => {
    expect(() => calculateEMA(series([1, 2, 3]), { period: 0 })).toThrow(
      /positive integer/
    );
  });
});

describe("calculateRSI", () => {
  it("returns 50 on constant series and never exceeds bounds", () => {
    const result = calculateRSI(series(Array(10).fill(42)), { period: 5 });
    expect(result[5]).toBe(50);
    for (const value of result) {
      if (value === null) {
        continue;
      }
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("returns all null when the input is shorter than the window", () => {
    const result = calculateRSI(series([1, 2, 3, 4]), { period: 10 });
    expect(result).toEqual([null, null, null, null]);
  });

  it("reflects directional moves without breaching the canonical bounds", () => {
    const rising = calculateRSI(series([10, 11, 12, 13, 14, 15, 16]), {
      period: 3,
    });
    const falling = calculateRSI(series([20, 19, 18, 17, 16, 15, 14]), {
      period: 3,
    });

    const risingValues = rising.filter((value): value is number => value !== null);
    const fallingValues = falling.filter((value): value is number => value !== null);

    expect(risingValues.every((value) => value >= 60 && value <= 100)).toBe(true);
    expect(fallingValues.every((value) => value <= 40 && value >= 0)).toBe(true);
  });
});
