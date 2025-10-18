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

  it("normalises lowercase timeframe inputs before validation", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/finance/history?symbol=AAPL&timeframe=1d&limit=2"
      )
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timeframe).toBe("1D");
    expect(payload.count).toBe(2);
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
    expect(error.error.message).toMatch(/Unsupported timeframe/);
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
    expect(error.error.message).toMatch(/maximum of 5000/);
  });

  it("rejects decimal limits to avoid silent truncation", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/history?symbol=AAPL&limit=5.5")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.message).toMatch(/positive integer/);
  });

  it("rejects blank symbols after trimming whitespace", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/finance/history?symbol=%20%20%20&limit=1"
      )
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.message).toMatch(/symbol must not be empty/);
  });

  it("rejects malformed from parameters with a descriptive error", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/finance/history?symbol=AAPL&from=not-a-date"
      )
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.message).toMatch(/Field 'from' must be a valid ISO date/i);
  });

  it("normalises reversed ranges before resolving the series", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/finance/history?symbol=AAPL&from=2024-06-10T00:00:00Z&to=2024-06-01T00:00:00Z"
      )
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.range.from).toBeLessThanOrEqual(payload.range.to);
  });

  it("returns a forbidden error when the finance feature flag is disabled", async () => {
    vi.stubEnv("FEATURE_FINANCE", "false");

    try {
      const response = await GET(
        new Request("http://localhost/api/finance/history?symbol=AAPL")
      );

      expect(response.status).toBe(403);
      const error = await response.json();
      expect(error.error.code).toBe("forbidden:api");
      expect(error.error.message).toMatch(/Finance endpoints are disabled/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
