import "server-only";

import { ChatSDKError } from "./errors";

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
  readonly remaining: number;
  readonly reset: number;
}

const buckets = new Map<string, RateLimitBucket>();

/**
 * Simple fixed-window rate limiter. The implementation is intentionally
 * lightweight so it can operate without Redis in local development and during
 * unit tests while sharing the same API surface as a production-grade limiter.
 */
export function enforceRateLimit(options: RateLimitOptions): RateLimitResult {
  const { key, limit, windowMs, now = Date.now() } = options;

  /**
   * End-to-end suites set `PLAYWRIGHT=true` to signal that deterministic mocks
   * are in effect. Relax the limiter by a generous multiplier so tests can hit
   * the same route repeatedly without tripping 429s while keeping production
   * behaviour intact.
   */
  const limitMultiplier = process.env.PLAYWRIGHT === "true" ? 100 : 1;
  const effectiveLimit = limit * limitMultiplier;

  if (limit <= 0 || windowMs <= 0) {
    throw new Error("Rate limit options must be positive.");
  }

  const existing = buckets.get(key);

  if (!existing || existing.expiresAt <= now) {
    const bucket: RateLimitBucket = {
      count: 1,
      expiresAt: now + windowMs,
    };
    buckets.set(key, bucket);
    return {
      remaining: Math.max(effectiveLimit - 1, 0),
      reset: bucket.expiresAt,
    };
  }

  if (existing.count >= effectiveLimit) {
    throw new ChatSDKError(
      "rate_limit:api",
      `Rate limit exceeded for key '${key}'.`
    );
  }

  existing.count += 1;
  return {
    remaining: Math.max(effectiveLimit - existing.count, 0),
    reset: existing.expiresAt,
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
