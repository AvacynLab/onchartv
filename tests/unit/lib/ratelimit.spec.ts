import { afterEach, describe, expect, it, vi } from "vitest";

// Next.js marks certain modules as server-only which throw when evaluated in a
// generic test environment. Mock the export so Vitest can import the limiter.
vi.mock("server-only", () => ({}));

import {
  __resetRateLimitStateForTests,
  enforceRateLimit,
} from "@/lib/ratelimit";
import { ChatSDKError } from "@/lib/errors";

/**
 * Utility preserving the original PLAYWRIGHT flag across test cases so env
 * mutations never leak between assertions.
 */
const preservePlaywrightFlag = () => {
  const original = process.env.PLAYWRIGHT;
  return () => {
    if (typeof original === "undefined") {
      delete process.env.PLAYWRIGHT;
    } else {
      process.env.PLAYWRIGHT = original;
    }
  };
};

const resetPlaywrightFlag = preservePlaywrightFlag();

afterEach(() => {
  __resetRateLimitStateForTests();
  resetPlaywrightFlag();
});

describe("enforceRateLimit", () => {
  it("throws when exceeding the configured quota in normal conditions", () => {
    const options = { key: "user-1", limit: 2, windowMs: 1_000 } as const;

    enforceRateLimit(options);
    enforceRateLimit(options);

    expect(() => enforceRateLimit(options)).toThrowError(ChatSDKError);
  });

  it("relaxes the quota by two orders of magnitude when PLAYWRIGHT is true", () => {
    process.env.PLAYWRIGHT = "true";
    const options = { key: "user-2", limit: 2, windowMs: 1_000 } as const;

    // 150 requests would exceed the baseline limit (2) but stays within the
    // boosted ceiling of 200 that activates when PLAYWRIGHT=true.
    for (let attempt = 0; attempt < 150; attempt += 1) {
      enforceRateLimit(options);
    }

    expect(() => enforceRateLimit(options)).not.toThrow();
  });

  it("reports remaining requests relative to the effective quota", () => {
    const options = { key: "user-3", limit: 3, windowMs: 500 } as const;

    // The fixed-window limiter decrements the remaining quota on each call so
    // we check the monotonic decrease matches expectations.
    const first = enforceRateLimit(options);
    expect(first.remaining).toBe(2);

    const second = enforceRateLimit(options);
    expect(second.remaining).toBe(1);
  });
});
