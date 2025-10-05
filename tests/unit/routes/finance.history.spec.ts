const originalPlaywright = process.env.PLAYWRIGHT;
// Align the mocked environment with `PLAYWRIGHT=true` so hermetic code paths
// mirror the behaviour exercised by Playwright.
process.env.PLAYWRIGHT = "true";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/finance/history/route";
import { getMarketDataAdapter } from "@/lib/finance/server-adapter";
import { __resetRateLimitStateForTests } from "@/lib/ratelimit";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  __resetRateLimitStateForTests();
});

afterEach(() => {
  __resetRateLimitStateForTests();
});

afterAll(() => {
  if (originalPlaywright) {
    process.env.PLAYWRIGHT = originalPlaywright;
  } else {
    delete process.env.PLAYWRIGHT;
  }
});

describe("/api/finance/history", () => {
  it("returns a capped number of candles when limit is provided", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/history?symbol=AAPL&limit=5")
    );
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.symbol).toBe("AAPL");
    expect(payload.timeframe).toBe("1D");
    expect(payload.count).toBe(5);
    expect(payload.ohlcv).toHaveLength(5);
    expect(payload.ohlcv[0]).toHaveProperty("timestamp");
    expect(payload.ohlcv[0]).toHaveProperty("close");
  });

  it("rejects unsupported timeframes", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/finance/history?symbol=AAPL&timeframe=1H"
      )
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
  });

  it("caps the default candle count to the maximum when the adapter returns more", async () => {
    const adapter = getMarketDataAdapter();
    const largeSeries = Array.from({ length: 6_000 }, (_, index) => ({
      timestamp: 1_600_000_000 + index * 86_400,
      open: 100 + index,
      high: 105 + index,
      low: 95 + index,
      close: 102 + index,
      volume: 1_000 + index,
    }));
    const historySpy = vi
      .spyOn(adapter, "history")
      .mockResolvedValueOnce(largeSeries);

    const response = await GET(
      new Request("http://localhost/api/finance/history?symbol=AAPL")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.count).toBe(5_000);
    expect(payload.ohlcv).toHaveLength(5_000);
    expect(historySpy).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5_000 })
    );

    historySpy.mockRestore();
  });

  it("rejects limits above the server-side maximum", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/history?symbol=AAPL&limit=6000")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.cause).toMatch(/maximum of 5000/);
  });

  it("rejects decimal limits to avoid silent truncation", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/history?symbol=AAPL&limit=5.5")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.cause).toMatch(/positive integer/);
  });

  it("rejects ranges where 'from' is later than 'to'", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/finance/history?symbol=AAPL&from=2024-06-10T00:00:00Z&to=2024-06-01T00:00:00Z"
      )
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.cause).toMatch(/earlier than 'to'/);
  });
});
