import { afterEach, describe, expect, it, vi } from "vitest";

// Next.js marks certain modules as server-only which throw when evaluated in a
// generic test environment. Mock the export so Vitest can import the limiter.
vi.mock("server-only", () => ({}));

import {
  __resetRateLimitStateForTests,
  enforceRateLimit,
} from "@/lib/ratelimit";
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
  it("flags requests once the configured quota is exceeded in normal conditions", () => {
    // CI sets PLAYWRIGHT=true so e2e flows skip the limiter. Explicitly remove
    // the flag to exercise the baseline production behaviour in this test.
    delete process.env.PLAYWRIGHT;

    const options = { key: "user-1", limit: 2, windowMs: 1_000 } as const;

    const first = enforceRateLimit(options);
    const second = enforceRateLimit(options);
    const third = enforceRateLimit(options);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });

  it("fully bypasses the quota when PLAYWRIGHT is true", () => {
    process.env.PLAYWRIGHT = "true";
    const options = { key: "user-2", limit: 2, windowMs: 1_000 } as const;

    // 150 requests would exceed the baseline limit (2) but hermetic mode keeps
    // allowing them without touching the shared buckets.
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const verdict = enforceRateLimit(options);
      expect(verdict.allowed).toBe(true);
      expect(verdict.resetInMs).toBe(0);
    }
  });

  it("does not leak Playwright bypass state once the flag is disabled", () => {
    process.env.PLAYWRIGHT = "true";
    const options = { key: "user-4", limit: 2, windowMs: 1_000 } as const;

    // Trigger a large number of requests while the bypass is active to ensure
    // no internal bucket gets populated for the key.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const verdict = enforceRateLimit(options);
      expect(verdict.allowed).toBe(true);
    }

    // Reset the flag to mimic the behaviour outside Playwright runs. The next
    // call must behave like the first ever request from this key; if the bypass
    // leaked state, the quota would already be exhausted.
    delete process.env.PLAYWRIGHT;

    const firstVerdictAfterBypass = enforceRateLimit(options);
    expect(firstVerdictAfterBypass.allowed).toBe(true);
    expect(firstVerdictAfterBypass.remaining).toBe(1);
  });

  it("reports remaining requests relative to the effective quota", () => {
    // Ensure the relaxed Playwright quota does not interfere with the
    // assertions that follow.
    delete process.env.PLAYWRIGHT;

    const options = { key: "user-3", limit: 3, windowMs: 500 } as const;

    // The fixed-window limiter decrements the remaining quota on each call so
    // we check the monotonic decrease matches expectations.
    const first = enforceRateLimit(options);
    expect(first).toEqual(
      expect.objectContaining({ allowed: true, remaining: 2 })
    );

    const second = enforceRateLimit(options);
    expect(second).toEqual(
      expect.objectContaining({ allowed: true, remaining: 1 })
    );
  });
});
