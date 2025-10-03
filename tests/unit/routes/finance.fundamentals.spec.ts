const originalPlaywright = process.env.PLAYWRIGHT;
// Normalise the hermetic flag so the deterministic mocks stay active across the
// finance routes, mirroring the environment used by Playwright.
process.env.PLAYWRIGHT = "true";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/finance/fundamentals/route";
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
  it("returns a deterministic snapshot for supported symbols", async () => {
    // Request fundamentals for AAPL to ensure the handler returns the mock
    // snapshot without hitting external providers.
    const response = await GET(
      new Request("http://localhost/api/finance/fundamentals?symbol=AAPL")
    );

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.symbol).toBe("AAPL");
    expect(payload.metrics).toHaveProperty("peRatio");
    expect(payload.source).toBe("mock");
  });

  it("rejects unsupported symbols with a unified error payload", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/fundamentals?symbol=UNKNOWN")
    );

    expect(response.status).toBe(400);

    const error = await response.json();
    expect(error).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "bad_request:api",
          message: expect.stringContaining("request couldn't be processed"),
          cause: expect.stringContaining("Unsupported symbol"),
        }),
      })
    );
  });
});
