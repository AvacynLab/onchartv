const originalPlaywright = process.env.PLAYWRIGHT;
// Finance APIs relax their throttling limits when Playwright mode is active.
// Mirror that setting so unit tests cover the same fast-path exercised by the
// hermetic E2E journey.
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

describe("/api/finance/news", () => {
  it("returns the latest headlines sorted by recency", async () => {
    const { GET } = await import("@/app/api/finance/news/route");

    const response = await GET(
      new Request("http://localhost/api/finance/news?symbol=NVDA&limit=2")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.count).toBe(2);
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].publishedAt >= payload.items[1].publishedAt).toBe(true);
    expect(payload.items.every((item: { symbol: string }) => item.symbol === "NVDA"))
      .toBe(true);
  });

  it("rejects non-numeric limits to avoid silent coercion", async () => {
    const { GET } = await import("@/app/api/finance/news/route");

    const response = await GET(
      new Request("http://localhost/api/finance/news?symbol=NVDA&limit=two")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error).toEqual(
      expect.objectContaining({
        code: "bad_request:api",
        message: expect.stringContaining("positive integer"),
      })
    );
  });

  it("caps the number of requested articles to the configured maximum", async () => {
    const { GET } = await import("@/app/api/finance/news/route");

    const response = await GET(
      new Request("http://localhost/api/finance/news?symbol=NVDA&limit=100")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.message).toMatch(/cannot exceed 50/);
  });

  it("rejects unknown symbols", async () => {
    const { GET } = await import("@/app/api/finance/news/route");

    const response = await GET(
      new Request("http://localhost/api/finance/news?symbol=XYZ")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.message).toMatch(/Unsupported symbol/);
  });

  it("returns forbidden when the finance feature flag is disabled", async () => {
    vi.stubEnv("FEATURE_FINANCE", "false");

    try {
      const { GET } = await import("@/app/api/finance/news/route");
      const response = await GET(
        new Request("http://localhost/api/finance/news?symbol=NVDA")
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
