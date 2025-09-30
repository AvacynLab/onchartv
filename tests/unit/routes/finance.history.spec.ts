const originalPlaywright = process.env.PLAYWRIGHT;
process.env.PLAYWRIGHT = "1";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/finance/history/route";
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
    expect(error.code).toBe("bad_request:api");
  });
});
