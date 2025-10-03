import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatSDKError } from "@/lib/errors";
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

  it("throws once the configured quota is exceeded in normal environments", () => {
    const options = { key: "user-1", limit: 2, windowMs: 1_000 } as const;

    enforceRateLimit(options);
    enforceRateLimit(options);

    expect(() => enforceRateLimit(options)).toThrow(ChatSDKError);
  });

  it("relaxes the limiter when PLAYWRIGHT mode is active", () => {
    process.env.PLAYWRIGHT = "true";

    const options = { key: "user-2", limit: 2, windowMs: 1_000 } as const;

    // The third request would normally fail but the bypass keeps tests flowing.
    expect(() => {
      enforceRateLimit(options);
      enforceRateLimit(options);
      enforceRateLimit(options);
    }).not.toThrow();
  });

  it("still tracks remaining quota for callers", () => {
    const options = { key: "user-3", limit: 5, windowMs: 1_000 } as const;

    const first = enforceRateLimit(options);
    const second = enforceRateLimit(options);

    expect(first.remaining).toBe(4);
    expect(second.remaining).toBe(3);
  });
});
