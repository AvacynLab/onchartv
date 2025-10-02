const originalPlaywright = process.env.PLAYWRIGHT;
// Toggle the hermetic flag to "true" so the screening route exercises the
// offline path used in end-to-end tests.
process.env.PLAYWRIGHT = "true";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/finance/screen/route";
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
  it("filters assets by market cap and type", async () => {
    // Request a filtered universe focusing on large-cap equities.
    const response = await POST(
      new Request("http://localhost/api/finance/screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: { minMarketCap: 1e12, assetTypes: ["equity"] },
          limit: 3,
        }),
      })
    );

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.type).toBe("finance.screen");
    expect(payload.results.length).toBeLessThanOrEqual(3);
    expect(payload.results.every((entry: { type: string; marketCap: number }) => entry.type === "equity"))
      .toBe(true);

    if (payload.results.length >= 2) {
      expect(payload.results[0].marketCap).toBeGreaterThanOrEqual(payload.results[1].marketCap);
    }
  });

  it("accepts filters referencing asset classes without catalog coverage", async () => {
    // Commodity filters are valid even if the offline catalogue currently lacks entries.
    const response = await POST(
      new Request("http://localhost/api/finance/screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filters: { assetTypes: ["commodity"] } }),
      })
    );

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.results).toEqual([]);
    expect(payload.appliedFilters.assetTypes).toEqual(["commodity"]);
  });

  it("rejects invalid filter payloads", async () => {
    // Negative ratios are rejected by the schema validation layer.
    const response = await POST(
      new Request("http://localhost/api/finance/screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filters: { maxPeRatio: -1 } }),
      })
    );

    expect(response.status).toBe(400);
  });

  it("defaults to an unfiltered catalogue when no body is provided", async () => {
    // Missing JSON should be treated as an empty payload rather than raising.
    const response = await POST(
      new Request("http://localhost/api/finance/screen", { method: "POST" })
    );

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.appliedFilters.assetTypes).toEqual([]);
  });
});
