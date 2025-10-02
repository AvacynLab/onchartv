const originalPlaywright = process.env.PLAYWRIGHT;
// Normalise the hermetic Playwright flag to the canonical "true" string so the
// routes exercise the same code paths as the e2e environment.
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

import { __resetRateLimitStateForTests } from "@/lib/ratelimit";
import type { Session } from "next-auth";

let listBacktestsByStrategy: (typeof import("@/lib/db/queries"))["listBacktestsByStrategy"];

vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/auth", () => ({ auth: vi.fn() }));

beforeEach(async () => {
  __resetRateLimitStateForTests();
  vi.resetModules();
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/app/(auth)/auth", () => ({
    auth: vi.fn(),
  }));
  const queries = await import("@/lib/db/queries");
  listBacktestsByStrategy = queries.listBacktestsByStrategy;
  const { auth } = await import("@/app/(auth)/auth");
  const session: Session = {
    user: {
      id: "user-1",
      type: "regular",
      email: "demo@example.com",
      name: "Demo User",
      image: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
  vi.mocked(auth).mockResolvedValue(session);
});

afterEach(() => {
  __resetRateLimitStateForTests();
  vi.clearAllMocks();
});

afterAll(() => {
  if (originalPlaywright) {
    process.env.PLAYWRIGHT = originalPlaywright;
  } else {
    delete process.env.PLAYWRIGHT;
  }
});

describe("/api/finance/backtest", () => {
  it("returns persisted backtest metrics for the SMA crossover", async () => {
    const { POST } = await import("@/app/api/finance/backtest/route");
    const request = new Request("http://localhost/api/finance/backtest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol: "AAPL",
        timeframe: "1D",
        period: {
          from: "2024-01-01T00:00:00Z",
          to: "2024-06-01T00:00:00Z",
        },
        strategy: {
          type: "sma-crossover",
          name: "SMA 20/50",
          params: { fastPeriod: 20, slowPeriod: 50 },
        },
        risk: {
          initialCapital: 25_000,
          commissionPerTrade: 1,
          slippageBps: 5,
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(typeof payload.runId).toBe("string");
    expect(payload.metrics).toHaveProperty("totalReturn");
    expect(Array.isArray(payload.trades)).toBe(true);
    expect(Array.isArray(payload.equityCurve)).toBe(true);

    const runs = await listBacktestsByStrategy({
      strategyId: payload.strategy.id,
      limit: 10,
    });
    expect(runs.some((run) => run.id === payload.runId)).toBe(true);
  });

  it("rejects unauthenticated callers", async () => {
    const { auth } = await import("@/app/(auth)/auth");
    vi.mocked(auth).mockResolvedValueOnce(null);

    const { POST } = await import("@/app/api/finance/backtest/route");
    const request = new Request("http://localhost/api/finance/backtest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol: "AAPL",
        timeframe: "1D",
        period: {
          from: "2024-01-01T00:00:00Z",
          to: "2024-06-01T00:00:00Z",
        },
        strategy: {
          type: "sma-crossover",
          name: "SMA 20/50",
          params: { fastPeriod: 20, slowPeriod: 50 },
        },
        risk: {
          initialCapital: 25_000,
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
