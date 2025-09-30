import "server-only";

import { performance } from "node:perf_hooks";

import { ChatSDKError } from "@/lib/errors";
import { findAssetMetadata, type FinanceAssetMetadata } from "./catalog";

/**
 * Validates and normalises a symbol string before using it downstream. The
 * helper raises a `ChatSDKError` so route handlers can surface consistent error
 * payloads back to the caller.
 */
export function assertSupportedSymbol(value: string): FinanceAssetMetadata {
  const metadata = findAssetMetadata(value);

  if (!metadata) {
    throw new ChatSDKError(
      "bad_request:api",
      `Unsupported symbol '${value}'.`
    );
  }

  return metadata;
}

/**
 * Parses an ISO-8601 string and returns epoch seconds. An invalid date triggers
 * a `bad_request` error so the caller receives actionable feedback.
 */
export function parseIsoToEpochSeconds(
  value: string,
  field: string
): number {
  const trimmed = value.trim();
  const numeric = Number(trimmed);

  if (!Number.isNaN(numeric)) {
    return Math.floor(numeric);
  }

  const parsed = Date.parse(trimmed);

  if (Number.isNaN(parsed)) {
    throw new ChatSDKError(
      "bad_request:api",
      `Field '${field}' must be a valid ISO date or epoch seconds.`
    );
  }

  return Math.floor(parsed / 1000);
}

/**
 * Resolves a stable identifier for rate limiting. X-Forwarded-For is preferred
 * but the fallback ensures deterministic behaviour in tests and local dev.
 */
export function resolveClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]!.trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return request.headers.get("x-user-id")?.trim() ?? "anonymous";
}

/**
 * Convenience wrapper around `performance.now()` so route handlers can compute
 * latencies while keeping logging consistent.
 */
export function now(): number {
  return performance.now();
}

/**
 * Formats an info log entry with route metadata. Logging is intentionally noisy
 * in development/test so we can quickly triage behaviour without digging into
 * request traces.
 */
export function logRouteLatency(
  route: string,
  startedAt: number,
  extra: Record<string, unknown> = {}
): void {
  const duration = performance.now() - startedAt;
  console.info(`[api:${route}] completed in ${duration.toFixed(1)}ms`, extra);
}

/**
 * Returns the canonical tuple describing the requested time range. When the
 * caller omits `from`/`to` we fall back to the series boundaries so charts and
 * backtests still have data to operate on.
 */
export function resolveRange(
  candles: ReadonlyArray<{ timestamp: number }>,
  from?: number,
  to?: number
): { from: number; to: number } {
  if (candles.length === 0) {
    throw new ChatSDKError(
      "bad_request:api",
      "Requested symbol does not have any historical data."
    );
  }

  const earliest = candles[0]!.timestamp;
  const latest = candles[candles.length - 1]!.timestamp;

  const resolvedFrom = from ?? earliest;
  const resolvedTo = to ?? latest;

  if (resolvedFrom > resolvedTo) {
    throw new ChatSDKError(
      "bad_request:api",
      "Parameter 'from' must be earlier than 'to'."
    );
  }

  return {
    from: Math.max(resolvedFrom, earliest),
    to: Math.min(resolvedTo, latest),
  };
}

/** Utility to cap the number of candles returned so responses stay lightweight. */
export function applyHistoryLimit<T>(
  series: ReadonlyArray<T>,
  limit?: number
): T[] {
  if (!limit || limit <= 0) {
    return [...series];
  }

  return [...series.slice(-limit)];
}
