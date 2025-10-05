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

const BASE_PAYLOAD = {
  symbol: "AAPL",
  timeframe: "1D",
  period: {
    from: "2024-01-01T00:00:00Z",
    to: "2024-06-01T00:00:00Z",
  },
  strategy: {
    type: "sma-crossover" as const,
    name: "SMA 20/50",
    params: { fastPeriod: 20, slowPeriod: 50 },
  },
  risk: {
    initialCapital: 25_000,
    commissionPerTrade: 1,
    slippageBps: 5,
  },
} as const;

function buildRequest(override: Record<string, unknown>) {
  /**
   * Compose the JSON payload on every invocation to avoid sharing mutable state
   * across tests. `structuredClone` keeps nested objects intact without leaking
   * references into Vitest's module cache.
   */
  const body = structuredClone(BASE_PAYLOAD);
  Object.assign(body, override);

  return new Request("http://localhost/api/finance/backtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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
    const request = buildRequest({});

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

  it("streams enough trades to exercise the paginated journal", async () => {
    const { POST } = await import("@/app/api/finance/backtest/route");
    const request = buildRequest({
      period: {
        from: "2018-01-01T00:00:00Z",
        to: "2020-12-31T00:00:00Z",
      },
      strategy: {
        type: "sma-crossover" as const,
        name: "SMA 50/200",
        params: { fastPeriod: 50, slowPeriod: 200 },
      },
      risk: { initialCapital: 100_000, commissionPerTrade: 1, slippageBps: 10 },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(Array.isArray(payload.trades)).toBe(true);
    expect(payload.trades.length).toBeGreaterThan(8);
    expect(payload.metrics.trades).toBeGreaterThanOrEqual(payload.trades.length);
  });

  it("rejects unauthenticated callers", async () => {
    const { auth } = await import("@/app/(auth)/auth");
    vi.mocked(auth).mockResolvedValueOnce(null);

    const { POST } = await import("@/app/api/finance/backtest/route");
    const request = buildRequest({
      risk: { initialCapital: 25_000 },
    });

    const response = await POST(request);
    expect(response.status).toBe(401);

    const error = await response.json();
    expect(error).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "unauthorized:auth",
          message: expect.stringContaining("sign in"),
          cause: expect.stringContaining("signed in"),
        }),
      })
    );
  });

  it("rejects unsupported timeframes", async () => {
    const { POST } = await import("@/app/api/finance/backtest/route");
    const response = await POST(
      buildRequest({ timeframe: "4H" })
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.cause).toMatch(/Unsupported timeframe/);
  });

  it("rejects SMA windows where the fast period is not strictly shorter", async () => {
    const { POST } = await import("@/app/api/finance/backtest/route");
    const response = await POST(
      buildRequest({
        strategy: {
          ...BASE_PAYLOAD.strategy,
          params: { fastPeriod: 50, slowPeriod: 50 },
        },
      })
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.cause).toMatch(/strictly less than/);
  });

  it("rejects periods where 'from' is later than 'to'", async () => {
    const { POST } = await import("@/app/api/finance/backtest/route");
    const response = await POST(
      buildRequest({
        period: {
          from: "2024-06-01T00:00:00Z",
          to: "2024-05-01T00:00:00Z",
        },
      })
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.cause).toMatch(/earlier than 'to'/);
  });
});
