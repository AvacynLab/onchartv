const originalPlaywright = process.env.PLAYWRIGHT;
// Keep the hermetic mocks enabled so the quote endpoint uses the deterministic
// adapter exercised in end-to-end tests.
process.env.PLAYWRIGHT = "true";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/finance/quote/route";
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

describe("/api/finance/quote", () => {
  it("returns the latest mock price for supported symbols", async () => {
    // Request a quote for NVDA and ensure the payload comes from the deterministic
    // dataset shipped with the repository.
    const response = await GET(
      new Request("http://localhost/api/finance/quote?symbol=NVDA")
    );

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.symbol).toBe("NVDA");
    expect(typeof payload.price).toBe("number");
    expect(payload.source).toBe("mock");
  });

  it("rejects unsupported symbols with a consistent error shape", async () => {
    const response = await GET(
      new Request("http://localhost/api/finance/quote?symbol=UNKNOWN")
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
