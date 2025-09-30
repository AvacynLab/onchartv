import { z } from "zod";

import {
  applyHistoryLimit,
  assertSupportedSymbol,
  logRouteLatency,
  now,
  parseIsoToEpochSeconds,
  resolveClientKey,
  resolveRange,
} from "@/lib/finance/api-utils";
import { FINANCE_SERIES } from "@/lib/finance/mock-data";
import { getMarketDataAdapter } from "@/lib/finance/server-adapter";
import { ChatSDKError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/ratelimit";

const MAX_CANDLES = 5_000;
const SUPPORTED_TIMEFRAMES = ["1D"] as const;

/** Schema guarding the query string of the history endpoint. */
const querySchema = z.object({
  symbol: z
    .string({ required_error: "symbol is required" })
    .min(1, "symbol must not be empty"),
  timeframe: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.string().optional(),
});

/**
 * Streams historical OHLCV candles for the requested symbol and timeframe. The
 * implementation favours determinism so tests and offline environments can rely
 * on identical datasets.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = now();
  const clientKey = resolveClientKey(request);

  try {
    const rateLimit = enforceRateLimit({
      key: `finance:history:${clientKey}`,
      limit: 60,
      windowMs: 60_000,
    });

    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = querySchema.safeParse(params);

    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new ChatSDKError("bad_request:api", detail);
    }

    const metadata = assertSupportedSymbol(parsed.data.symbol);
    const timeframe = (parsed.data.timeframe ?? "1D").trim().toUpperCase();

    if (!SUPPORTED_TIMEFRAMES.includes(timeframe as (typeof SUPPORTED_TIMEFRAMES)[number])) {
      throw new ChatSDKError(
        "bad_request:api",
        `Unsupported timeframe '${parsed.data.timeframe ?? ""}'. Only 1D candles are available in the offline catalogue.`
      );
    }

    const series = FINANCE_SERIES[metadata.symbol];
    const fromEpoch = parsed.data.from
      ? parseIsoToEpochSeconds(parsed.data.from, "from")
      : undefined;
    const toEpoch = parsed.data.to
      ? parseIsoToEpochSeconds(parsed.data.to, "to")
      : undefined;

    const range = resolveRange(series, fromEpoch, toEpoch);

    const limit = parsed.data.limit
      ? Number.parseInt(parsed.data.limit, 10)
      : undefined;

    if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
      throw new ChatSDKError(
        "bad_request:api",
        "Parameter 'limit' must be a positive integer when provided."
      );
    }

    if (limit !== undefined && limit > MAX_CANDLES) {
      throw new ChatSDKError(
        "bad_request:api",
        `Requested limit ${limit} exceeds the maximum of ${MAX_CANDLES} candles.`
      );
    }

    const adapter = getMarketDataAdapter();
    const candles = await adapter.history({
      symbol: metadata.symbol,
      timeframe,
      from: range.from,
      to: range.to,
      limit,
    });

    const payload = applyHistoryLimit(candles, limit);

    return Response.json({
      symbol: metadata.symbol,
      timeframe,
      range,
      ohlcv: payload.map((candle) => ({
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })),
      count: payload.length,
      rateLimit,
      source: "mock",
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    console.error("[api:finance.history] unexpected error", error);
    return Response.json(
      { code: "internal_error:api", message: "Unexpected error while fetching history." },
      { status: 500 }
    );
  } finally {
    logRouteLatency("finance.history", startedAt, { clientKey });
  }
}
