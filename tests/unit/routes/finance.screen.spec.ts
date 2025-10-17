const originalPlaywright = process.env.PLAYWRIGHT;
// The screener endpoint enforces request quotas unless Playwright mode is on.
// Match the e2e configuration to avoid tripping rate limits in unit tests.
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

describe("/api/finance/screen", () => {
  it("returns equity matches ordered by market cap", async () => {
    const { POST } = await import("@/app/api/finance/screen/route");

    const response = await POST(
      new Request("http://localhost/api/finance/screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: { assetTypes: ["equity"], minMarketCap: 1e12 },
          limit: 5,
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.results.length).toBeGreaterThan(0);
    const marketCaps = payload.results.map(
      (result: { marketCap: number }) => result.marketCap
    );
    const sortedByMarketCap = [...marketCaps].sort((a, b) => b - a);
    expect(marketCaps).toEqual(sortedByMarketCap);
    expect(payload.appliedFilters.assetTypes).toEqual(["equity"]);
  });

  it("rejects invalid JSON payloads", async () => {
    const { POST } = await import("@/app/api/finance/screen/route");

    const response = await POST(
      new Request("http://localhost/api/finance/screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid}",
      })
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.message).toMatch(/valid JSON/);
  });

  it("rejects requests with a limit above the maximum", async () => {
    const { POST } = await import("@/app/api/finance/screen/route");

    const response = await POST(
      new Request("http://localhost/api/finance/screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      })
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.message).toMatch(/cannot exceed 25/);
  });

  it("returns forbidden when the finance feature flag is disabled", async () => {
    vi.stubEnv("FEATURE_FINANCE", "false");

    try {
      const { POST } = await import("@/app/api/finance/screen/route");
      const response = await POST(
        new Request("http://localhost/api/finance/screen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 5 }),
        })
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
