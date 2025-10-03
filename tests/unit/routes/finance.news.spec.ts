const originalPlaywright = process.env.PLAYWRIGHT;
// Ensure Playwright-aware guards see the explicit "true" value, matching the
// contract expected by the finance routes.
process.env.PLAYWRIGHT = "true";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/finance/news/route";
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
  it("returns the requested number of news items sorted by recency", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/news?symbol=AAPL&limit=2")
    );
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.symbol).toBe("AAPL");
    expect(payload.items).toHaveLength(2);
    expect(new Date(payload.items[0].publishedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(payload.items[1].publishedAt).getTime()
    );
  });

  it("exposes three NVDA headlines when the agent requests \"3 news\"", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/news?symbol=NVDA&limit=3")
    );

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.symbol).toBe("NVDA");
    expect(payload.items).toHaveLength(3);

    /**
     * The timestamps decrease chronologically so Playwright can assert both the
     * count and the ordering when exercising the NVDA scenario. A failure here
     * would surface if the offline catalogue accidentally drops an entry.
     */
    expect(new Date(payload.items[0].publishedAt).getTime()).toBeGreaterThan(
      new Date(payload.items[2].publishedAt).getTime()
    );
  });

  it("rejects non-positive limits", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/news?symbol=AAPL&limit=0")
    );
    expect(response.status).toBe(400);

    const error = await response.json();
    expect(error).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "bad_request:api",
          message: expect.stringContaining("request couldn't be processed"),
          cause: expect.stringContaining("positive integer"),
        }),
      })
    );
  });

  it("rejects decimal limits to avoid implicit truncation", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/news?symbol=AAPL&limit=2.5")
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.code).toBe("bad_request:api");
    expect(error.error.cause).toMatch(/positive integer/);
  });
});
