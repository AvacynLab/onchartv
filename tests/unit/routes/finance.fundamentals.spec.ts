const originalPlaywright = process.env.PLAYWRIGHT;
// Hermetic finance routes loosen their rate limits when Playwright mode is
// enabled. Align the unit test environment with the e2e configuration so the
// handlers follow the same execution path.
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

describe("/api/finance/fundamentals", () => {
  it("returns the mock snapshot for a supported symbol", async () => {
    const { GET } = await import("@/app/api/finance/fundamentals/route");

    const response = await GET(
      new Request("http://localhost/api/finance/fundamentals?symbol=NVDA")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.symbol).toBe("NVDA");
    expect(payload.metrics).toEqual(
      expect.objectContaining({
        marketCap: expect.any(Number),
        revenueTtm: expect.any(Number),
      })
    );
    expect(payload.rateLimit).toEqual(
      expect.objectContaining({
        allowed: true,
        remaining: expect.any(Number),
        reset: expect.any(Number),
        resetInMs: expect.any(Number),
      })
    );
  });

  it("rejects requests missing the symbol parameter", async () => {
    const { GET } = await import("@/app/api/finance/fundamentals/route");

    const response = await GET(
      new Request("http://localhost/api/finance/fundamentals")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error).toEqual(
      expect.objectContaining({
        code: "bad_request:api",
        cause: expect.stringContaining("symbol"),
      })
    );
  });

  it("rejects unsupported symbols with a formatted error payload", async () => {
    const { GET } = await import("@/app/api/finance/fundamentals/route");

    const response = await GET(
      new Request("http://localhost/api/finance/fundamentals?symbol=TSLA")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error).toEqual(
      expect.objectContaining({
        code: "bad_request:api",
        cause: expect.stringContaining("Unsupported symbol"),
      })
    );
  });

  it("returns forbidden when the finance feature flag is disabled", async () => {
    vi.stubEnv("FEATURE_FINANCE", "false");

    try {
      const { GET } = await import("@/app/api/finance/fundamentals/route");
      const response = await GET(
        new Request("http://localhost/api/finance/fundamentals?symbol=NVDA")
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
