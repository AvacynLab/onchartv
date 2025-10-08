import { z } from "zod";

import {
  applyHistoryLimit,
  assertFinanceFeatureEnabled,
  assertSupportedSymbol,
  logRouteLatency,
  now,
  resolveClientKey,
  resolveRange,
} from "@/lib/finance/api-utils";
import { FINANCE_SERIES } from "@/lib/finance/mock-data";
import { getMarketDataAdapter } from "@/lib/finance/server-adapter";
import { ChatSDKError } from "@/lib/errors";
import { logError } from "@/lib/logging";
import { enforceRateLimit } from "@/lib/ratelimit";

const MAX_CANDLES = 5_000;
const SUPPORTED_TIMEFRAMES = ["1D"] as const;
const DEFAULT_TIMEFRAME = SUPPORTED_TIMEFRAMES[0];

type SupportedTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

/**
 * Builds a Zod schema that converts optional ISO/epoch payloads into epoch
 * seconds while surfacing consistent error messages for malformed inputs.
 */
const optionalEpochSchema = (field: string) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        return undefined;
      }

      const trimmed = value.trim();

      if (trimmed.length === 0) {
        return undefined;
      }

      const numeric = Number(trimmed);

      if (!Number.isNaN(numeric)) {
        return Math.floor(numeric);
      }

      const parsed = Date.parse(trimmed);

      if (Number.isNaN(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Field '${field}' must be a valid ISO date or epoch seconds.`,
        });
        return z.NEVER;
      }

      return Math.floor(parsed / 1000);
    });

/** Schema guarding and normalising the query string of the history endpoint. */
const querySchema = z.object({
  symbol: z
    .string({ required_error: "symbol is required" })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "symbol must not be empty"),
  timeframe: z
    .string()
    .optional()
    .transform((value, ctx) => {
      const normalised = (value ?? DEFAULT_TIMEFRAME).trim().toUpperCase();

      if (
        !SUPPORTED_TIMEFRAMES.includes(
          normalised as SupportedTimeframe
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported timeframe '${value ?? ""}'. Only 1D candles are available in the offline catalogue.`,
        });
        return z.NEVER;
      }

      return normalised as SupportedTimeframe;
    })
    .default(DEFAULT_TIMEFRAME),
  from: optionalEpochSchema("from"),
  to: optionalEpochSchema("to"),
  limit: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        return undefined;
      }

      const trimmed = value.trim();

      if (trimmed.length === 0) {
        return undefined;
      }

      if (!/^\d+$/.test(trimmed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Parameter 'limit' must be a positive integer when provided.",
        });
        return z.NEVER;
      }

      const parsed = Number.parseInt(trimmed, 10);

      if (parsed <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Parameter 'limit' must be a positive integer when provided.",
        });
        return z.NEVER;
      }

      if (parsed > MAX_CANDLES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Requested limit ${parsed} exceeds the maximum of ${MAX_CANDLES} candles.`,
        });
        return z.NEVER;
      }

      return parsed;
    }),
});

/**
 * Streams historical OHLCV candles for the requested symbol and timeframe. The
 * implementation favours determinism so tests and offline environments can rely
 * on identical datasets.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = now();
  const clientKey = resolveClientKey(request);
  let symbol: string | undefined;
  let timeframe: string | undefined;
  let limit: number | undefined;
  let fromEpoch: number | undefined;
  let toEpoch: number | undefined;

  try {
    assertFinanceFeatureEnabled();
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
    symbol = metadata.symbol;
    timeframe = parsed.data.timeframe;
    fromEpoch = parsed.data.from;
    toEpoch = parsed.data.to;
    limit = parsed.data.limit;

    const series = FINANCE_SERIES[metadata.symbol];
    const range = resolveRange(series, fromEpoch, toEpoch);

    /**
     * Clamp the effective limit so large date ranges never exceed the
     * server-side maximum. This keeps responses predictable and avoids
     * overwhelming the client when mocks are replaced by live providers.
     */
    const effectiveLimit = Math.min(limit ?? MAX_CANDLES, MAX_CANDLES);

    const adapter = getMarketDataAdapter();
    const candles = await adapter.history({
      symbol: metadata.symbol,
      timeframe,
      from: range.from,
      to: range.to,
      limit: effectiveLimit,
    });

    const payload = applyHistoryLimit(candles, effectiveLimit);

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

    logError("api:finance.history", error, {
      clientKey,
      symbol,
      timeframe,
      limit,
      from: fromEpoch,
      to: toEpoch,
    });
    return Response.json(
      {
        error: {
          code: "internal_error:api",
          message: "Unexpected error while fetching history.",
        },
      },
      { status: 500 }
    );
  } finally {
    logRouteLatency("finance.history", startedAt, { clientKey });
  }
}
