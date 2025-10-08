import { describe, expect, it, vi } from "vitest";

import {
  HttpMarketDataAdapter,
  InMemoryMarketDataAdapter,
} from "@/lib/finance/data-adapter";

import type { CandleSeries } from "@/lib/finance/types";

describe("InMemoryMarketDataAdapter", () => {
  it("returns defensive copies of the stored candles", async () => {
    const seed: Record<string, CandleSeries> = {
      DEMO: [
        {
          timestamp: 1_700_000_000,
          open: 10,
          high: 12,
          low: 9,
          close: 11,
          volume: 1_000,
        },
        {
          timestamp: 1_700_086_400,
          open: 11,
          high: 13,
          low: 10,
          close: 12,
          volume: 1_200,
        },
      ],
    };
    const adapter = new InMemoryMarketDataAdapter(seed);

    const candles = await adapter.history({
      symbol: "DEMO",
      timeframe: "1D",
      from: 1_699_913_600,
      to: 1_700_086_400,
    });

    expect(candles).toHaveLength(2);
    candles[0]!.close = 0;

    const replay = await adapter.history({
      symbol: "DEMO",
      timeframe: "1D",
      from: 1_699_913_600,
      to: 1_700_086_400,
    });

    expect(replay[0]!.close).toBe(11);
  });

  it("returns the most recent close price when quoting", async () => {
    const seed: Record<string, CandleSeries> = {
      DEMO: [
        {
          timestamp: 1_700_000_000,
          open: 10,
          high: 12,
          low: 9,
          close: 11,
          volume: 1_000,
        },
        {
          timestamp: 1_700_086_400,
          open: 11,
          high: 13,
          low: 10,
          close: 12,
          volume: 1_200,
        },
      ],
    };
    const adapter = new InMemoryMarketDataAdapter(seed);

    const quote = await adapter.quote({ symbol: "DEMO" });
    expect(quote).toEqual({ symbol: "DEMO", price: 12, timestamp: 1_700_086_400 });
  });
});

describe("HttpMarketDataAdapter", () => {
  it("coerces string payloads into numeric candles", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candles: [
            {
              timestamp: "1700000000",
              open: "10.5",
              high: "11.5",
              low: "9.8",
              close: "11.2",
              volume: "1500",
            },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
        }
      )
    );

    const adapter = new HttpMarketDataAdapter({
      baseUrl: "https://api.example.com",
      apiKey: "demo",
      fetch: fetchStub,
    });

    const candles = await adapter.history({
      symbol: "DEMO",
      timeframe: "1D",
      from: 1_700_000_000,
      to: 1_700_086_400,
      limit: 50,
    });

    expect(candles).toEqual([
      {
        timestamp: 1_700_000_000,
        open: 10.5,
        high: 11.5,
        low: 9.8,
        close: 11.2,
        volume: 1_500,
      },
    ]);
    expect(fetchStub).toHaveBeenCalled();
  });

  it("throws when the provider omits required candle fields", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candles: [
            {
              timestamp: "1700000000",
              open: "10",
              high: "11",
              close: "10.5",
              volume: "1000",
            },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
        }
      )
    );

    const adapter = new HttpMarketDataAdapter({
      baseUrl: "https://api.example.com",
      apiKey: "demo",
      fetch: fetchStub,
    });

    await expect(
      adapter.history({
        symbol: "DEMO",
        timeframe: "1D",
        from: 1_700_000_000,
        to: 1_700_086_400,
      })
    ).rejects.toThrow(/Invalid response/);
  });

  it("validates quote payloads and coalesces numeric strings", async () => {
    const fetchStub = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          symbol: "DEMO",
          price: "42.5",
          timestamp: "1700000000",
        }),
        { headers: { "content-type": "application/json" } }
      )
    );

    const adapter = new HttpMarketDataAdapter({
      baseUrl: "https://api.example.com",
      apiKey: "demo",
      fetch: fetchStub,
    });

    const quote = await adapter.quote({ symbol: "DEMO" });
    expect(quote).toEqual({ symbol: "DEMO", price: 42.5, timestamp: 1_700_000_000 });
  });
});
