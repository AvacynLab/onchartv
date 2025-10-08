const originalPlaywright = process.env.PLAYWRIGHT;
// Keep the rate limiter aligned with the hermetic Playwright behaviour so the
// quote handler exercises the relaxed quota applied during E2E runs.
process.env.PLAYWRIGHT = "true";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getMarketDataAdapter } from "@/lib/finance/server-adapter";
import { __resetRateLimitStateForTests } from "@/lib/ratelimit";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  __resetRateLimitStateForTests();
});

afterEach(() => {
  __resetRateLimitStateForTests();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (originalPlaywright) {
    process.env.PLAYWRIGHT = originalPlaywright;
  } else {
    delete process.env.PLAYWRIGHT;
  }
});

describe("/api/finance/quote", () => {
  it("returns the latest price for a supported symbol", async () => {
    const adapter = getMarketDataAdapter();
    const quoteSpy = vi.spyOn(adapter, "quote").mockResolvedValueOnce({
      symbol: "AAPL",
      price: 192.34,
      timestamp: 1_700_000_000,
    });

    const { GET } = await import("@/app/api/finance/quote/route");
    const response = await GET(
      new Request("http://localhost/api/finance/quote?symbol=AAPL")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(
      expect.objectContaining({
        symbol: "AAPL",
        price: 192.34,
        timestamp: 1_700_000_000,
      })
    );
    expect(quoteSpy).toHaveBeenCalledWith({ symbol: "AAPL" });
  });

  it("rejects requests missing the symbol", async () => {
    const { GET } = await import("@/app/api/finance/quote/route");

    const response = await GET(
      new Request("http://localhost/api/finance/quote")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.cause).toMatch(/symbol/);
  });

  it("rejects unsupported symbols", async () => {
    const { GET } = await import("@/app/api/finance/quote/route");

    const response = await GET(
      new Request("http://localhost/api/finance/quote?symbol=ZZZ")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.cause).toMatch(/Unsupported symbol/);
  });

  it("returns forbidden when the finance feature flag is disabled", async () => {
    vi.stubEnv("FEATURE_FINANCE", "false");

    try {
      const { GET } = await import("@/app/api/finance/quote/route");
      const response = await GET(
        new Request("http://localhost/api/finance/quote?symbol=AAPL")
      );

      expect(response.status).toBe(403);
      const error = await response.json();
      expect(error.error.code).toBe("forbidden:api");
      expect(error.error.cause).toMatch(/Finance endpoints are disabled/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
