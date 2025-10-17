import "server-only";

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { ChatSDKError } from "@/lib/errors";
import { isFinanceFeatureEnabled } from "@/lib/feature-flags";
import { logInfo } from "@/lib/logging";
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
 * Ensures the server-side finance feature flag is active before executing an
 * API handler. Returning early keeps routes hermetic when the flag is disabled
 * (e.g. in staging environments) and surfaces a consistent JSON error payload
 * to the caller.
 */
export function assertFinanceFeatureEnabled(): void {
  if (!isFinanceFeatureEnabled()) {
    throw new ChatSDKError(
      "forbidden:api",
      "Finance endpoints are disabled. Enable FEATURE_FINANCE to continue."
    );
  }
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
  const sanitized = sanitizeRouteExtra(extra);

  logInfo(
    `api:${route}`,
    `completed in ${duration.toFixed(1)}ms`,
    sanitized
  );
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

/** Patterns identifying fields that may contain personally identifiable data. */
const SENSITIVE_ROUTE_FIELD_PATTERNS = [/client/i, /user/i, /ip/i];

/**
 * Redacts sensitive metadata before emitting structured route logs. Non-sensitive
 * keys are forwarded unchanged so diagnostics remain actionable without leaking
 * IPs or user identifiers.
 */
function sanitizeRouteExtra(
  extra: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(extra)) {
    if (SENSITIVE_ROUTE_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
      sanitized[key] = anonymiseValue(value);
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

/**
 * Produces a deterministic fingerprint for potentially sensitive values. The
 * original value never leaves the process; the truncated hash is sufficient for
 * correlating requests across logs while preserving privacy.
 */
function anonymiseValue(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    const digest = createHash("sha256").update(value).digest("hex");
    return `[fingerprint:${digest.slice(0, 12)}]`;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    const digest = createHash("sha256")
      .update(String(value))
      .digest("hex");
    return `[fingerprint:${digest.slice(0, 12)}]`;
  }

  return "[redacted]";
}
