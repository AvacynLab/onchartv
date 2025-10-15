import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetRateLimitStateForTests,
  enforceRateLimit,
} from "@/lib/ratelimit";

/**
 * The hermetic Playwright suite exercises the same API surface repeatedly.
 * These tests document the conditional bypass we added so automated runs avoid
 * transient 429s while production traffic continues to enforce the regular
 * quota window.
 */
describe("enforceRateLimit", () => {
  const originalPlaywrightFlag = process.env.PLAYWRIGHT;

  beforeEach(() => {
    __resetRateLimitStateForTests();
    process.env.PLAYWRIGHT = originalPlaywrightFlag ?? undefined;
  });

  afterEach(() => {
    __resetRateLimitStateForTests();
    process.env.PLAYWRIGHT = originalPlaywrightFlag;
  });

  it("returns a denial once the configured quota is exceeded in normal environments", () => {
    const options = { key: "user-1", limit: 2, windowMs: 1_000 } as const;

    const first = enforceRateLimit(options);
    const second = enforceRateLimit(options);
    const third = enforceRateLimit(options);

    expect(first).toEqual(
      expect.objectContaining({ allowed: true, remaining: 1 })
    );
    expect(second).toEqual(
      expect.objectContaining({ allowed: true, remaining: 0 })
    );
    expect(third).toEqual(
      expect.objectContaining({ allowed: false, remaining: 0 })
    );
  });

  it("relaxes the limiter when PLAYWRIGHT mode is active", () => {
    process.env.PLAYWRIGHT = "true";

    const options = { key: "user-2", limit: 2, windowMs: 1_000 } as const;

    const first = enforceRateLimit(options);
    const second = enforceRateLimit(options);
    const third = enforceRateLimit(options);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(first.resetInMs).toBe(0);
  });

  it("still tracks remaining quota for callers", () => {
    const options = { key: "user-3", limit: 5, windowMs: 1_000 } as const;

    const first = enforceRateLimit(options);
    const second = enforceRateLimit(options);

    expect(first).toEqual(
      expect.objectContaining({ allowed: true, remaining: 4 })
    );
    expect(second).toEqual(
      expect.objectContaining({ allowed: true, remaining: 3 })
    );
  });
});
