import "server-only";

/** Internal bucket representation storing request counts and expiry timestamps. */
interface RateLimitBucket {
  count: number;
  expiresAt: number;
}

/** Input accepted by {@link enforceRateLimit}. */
export interface RateLimitOptions {
  /** Unique identifier for the caller (typically IP address or user id). */
  readonly key: string;
  /** Maximum number of requests allowed within the window. */
  readonly limit: number;
  /** Sliding window length expressed in milliseconds. */
  readonly windowMs: number;
  /** Optional override useful for deterministic unit tests. */
  readonly now?: number;
}

/** Result returned to callers so they can surface remaining quota if desired. */
export interface RateLimitResult {
  /** Whether the current request is allowed to proceed. */
  readonly allowed: boolean;
  /** Remaining quota within the active window (0 when denied). */
  readonly remaining: number;
  /** Epoch timestamp (ms) when the window resets. */
  readonly reset: number;
  /** Convenience delta expressing the remaining cooldown in milliseconds. */
  readonly resetInMs: number;
}

const buckets = new Map<string, RateLimitBucket>();

/**
 * Simple fixed-window rate limiter. The implementation is intentionally
 * lightweight so it can operate without Redis in local development and during
 * unit tests while sharing the same API surface as a production-grade limiter.
 */
export function enforceRateLimit(options: RateLimitOptions): RateLimitResult {
  const { key, limit, windowMs, now = Date.now() } = options;

  if (limit <= 0 || windowMs <= 0) {
    throw new Error("Rate limit options must be positive.");
  }

  /**
   * Playwright-driven end-to-end suites operate in a hermetic environment where
   * every finance route is mocked. Instead of throttling those calls we return
   * an always-allowed verdict which keeps the production code path intact while
   * preventing spurious 429s during automation.
   */
  if (process.env.PLAYWRIGHT === "true") {
    return {
      allowed: true,
      remaining: limit,
      reset: now + windowMs,
      resetInMs: 0,
    };
  }

  const existing = buckets.get(key);

  if (!existing || existing.expiresAt <= now) {
    const expiresAt = now + windowMs;
    const bucket: RateLimitBucket = {
      count: 1,
      expiresAt,
    };
    buckets.set(key, bucket);
    return {
      allowed: true,
      remaining: Math.max(limit - 1, 0),
      reset: expiresAt,
      resetInMs: Math.max(expiresAt - now, 0),
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      reset: existing.expiresAt,
      resetInMs: Math.max(existing.expiresAt - now, 0),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(limit - existing.count, 0),
    reset: existing.expiresAt,
    resetInMs: Math.max(existing.expiresAt - now, 0),
  };
}

/**
 * Test-only hook that clears the in-memory buckets. Keeping it exported makes it
 * straightforward for Vitest suites to run in isolation without leaking state
 * across cases.
 */
export function __resetRateLimitStateForTests(): void {
  buckets.clear();
}
