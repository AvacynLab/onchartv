import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpMarketDataAdapter } from "@/lib/finance/data-adapter";

/**
 * Unit coverage for the HTTP market data adapter. The tests stub `fetch` so the
 * implementation can be exercised without reaching out to the public internet,
 * mirroring the production behaviour when `FEATURE_USE_REAL_DATA=true`.
 */
describe("HttpMarketDataAdapter", () => {
  const BASE_URL = "https://provider.test/api";
  const API_KEY = "test-key";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and normalises candle history", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname.endsWith("/history")).toBe(true);
      expect(url.searchParams.get("symbol")).toBe("AAPL");
      expect(url.searchParams.get("apiKey")).toBe(API_KEY);
      return new Response(
        JSON.stringify({
          candles: [
            {
              timestamp: 1,
              open: "100",
              high: "110",
              low: "95",
              close: "105",
              volume: "12345",
            },
          ],
        }),
        { status: 200 }
      );
    });

    const adapter = new HttpMarketDataAdapter({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    const history = await adapter.history({
      symbol: "AAPL",
      timeframe: "1D",
      from: 0,
      to: 10,
    });

    expect(history).toEqual([
      {
        timestamp: 1,
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 12345,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches the latest quote", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname.endsWith("/quote")).toBe(true);
      expect(url.searchParams.get("symbol")).toBe("BTCUSD");
      return new Response(
        JSON.stringify({ symbol: "BTCUSD", price: "12345.67", timestamp: 42 }),
        { status: 200 }
      );
    });

    const adapter = new HttpMarketDataAdapter({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    const quote = await adapter.quote({ symbol: "BTCUSD" });

    expect(quote).toEqual({ symbol: "BTCUSD", price: 12345.67, timestamp: 42 });
  });

  it("fails fast on invalid payloads", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const adapter = new HttpMarketDataAdapter({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    await expect(adapter.quote({ symbol: "AAPL" })).rejects.toThrow(
      /Invalid response from market data provider for quote/
    );
  });

  it("surfaces HTTP errors with provider details", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: "rate limited" }), { status: 429 })
    );
    const adapter = new HttpMarketDataAdapter({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    await expect(
      adapter.history({ symbol: "AAPL", timeframe: "1D", from: 0, to: 10 })
    ).rejects.toThrow(/429/);
  });

  it("surfaces abort errors as timeout failures", async () => {
    const fetchMock = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    const adapter = new HttpMarketDataAdapter({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: fetchMock,
      timeoutMs: 5,
    });

    await expect(
      adapter.history({ symbol: "AAPL", timeframe: "1D", from: 0, to: 10 })
    ).rejects.toThrow(/timed out/i);
  });
});
