import { describe, expect, it } from "vitest";

import {
  InMemoryMarketDataAdapter,
  generateMockSeries,
} from "../../../lib/finance/data-adapter";

const SERIES = generateMockSeries({
  startTimestamp: 1_700_200_000,
  candles: 30,
  basePrice: 50,
  amplitude: 5,
  trendPerCandle: 0.1,
});

describe("InMemoryMarketDataAdapter", () => {
  const adapter = new InMemoryMarketDataAdapter({ BTCUSD: SERIES });

  it("returns slices of history constrained by time and limit", async () => {
    const from = SERIES[5].timestamp;
    const to = SERIES[20].timestamp;
    const candles = await adapter.history({
      symbol: "BTCUSD",
      timeframe: "1D",
      from,
      to,
      limit: 5,
    });

    expect(candles).toHaveLength(5);
    expect(candles[0].timestamp).toBe(SERIES[16].timestamp);
    expect(candles.at(-1)?.timestamp).toBe(SERIES[20].timestamp);
  });

  it("provides a quote using the most recent candle", async () => {
    const quote = await adapter.quote({ symbol: "BTCUSD" });
    const last = SERIES.at(-1)!;

    expect(quote.price).toBe(last.close);
    expect(quote.timestamp).toBe(last.timestamp);
  });

  it("throws when requesting an unknown symbol", async () => {
    await expect(
      adapter.history({
        symbol: "ETHUSD",
        timeframe: "1D",
        from: SERIES[0].timestamp,
        to: SERIES[1].timestamp,
      })
    ).rejects.toThrow(/Unknown symbol/);
  });
});
