import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  assertSupportedSymbol,
  assertFinanceFeatureEnabled,
  logRouteLatency,
  now,
  resolveClientKey,
  resolveRange,
} from "@/lib/finance/api-utils";
import { runBacktest } from "@/lib/finance/backtest/engine";
import { FINANCE_SERIES } from "@/lib/finance/mock-data";
import {
  createBacktestRun,
  createStrategy,
  createStrategyVersion,
  upsertAsset,
} from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { logError } from "@/lib/logging";
import { enforceRateLimit } from "@/lib/ratelimit";
import type { BacktestParameters } from "@/lib/finance/types";

const SUPPORTED_TIMEFRAMES = ["1D"] as const;
const MAX_BACKTEST_RANGE_DAYS = 5_000;
const SECONDS_PER_DAY = 86_400;

const DEFAULT_TIMEFRAME = SUPPORTED_TIMEFRAMES[0];

const isoEpochSchema = (field: string) =>
  z
    .string({ required_error: `${field} is required` })
    .transform((value, ctx) => {
      const trimmed = value.trim();

      if (trimmed.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} must not be empty`,
        });
        return z.NEVER;
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

const requestSchema = z.object({
  symbol: z
    .string({ required_error: "symbol is required" })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "symbol must not be empty"),
  timeframe: z
    .string()
    .optional()
    .transform((value, ctx) => {
      const normalised = (value ?? DEFAULT_TIMEFRAME).trim().toUpperCase();

      if (!SUPPORTED_TIMEFRAMES.includes(normalised as (typeof SUPPORTED_TIMEFRAMES)[number])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported timeframe '${value ?? ""}'. Only 1D candles are available in the offline catalogue.`,
        });
        return z.NEVER;
      }

      return normalised as (typeof SUPPORTED_TIMEFRAMES)[number];
    })
    .default(DEFAULT_TIMEFRAME),
  period: z
    .object({
      from: isoEpochSchema("period.from"),
      to: isoEpochSchema("period.to"),
    })
    .superRefine((value, ctx) => {
      if (value.from > value.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Field 'period.from' must be earlier than 'period.to'.",
          path: ["from"],
        });
      }
    }),
  strategy: z.object({
    type: z.literal("sma-crossover"),
    name: z
      .string({ required_error: "strategy.name is required" })
      .transform((value) => value.trim())
      .refine((value) => value.length > 0, "strategy.name must not be empty"),
    description: z.string().max(500).optional(),
    strategyId: z.string().uuid().optional(),
    params: z
      .object({
        fastPeriod: z
          .number({ required_error: "strategy.params.fastPeriod is required" })
          .int()
          .min(1)
          .max(500),
        slowPeriod: z
          .number({ required_error: "strategy.params.slowPeriod is required" })
          .int()
          .min(1)
          .max(1_000),
      })
      .refine(
        (value) => value.fastPeriod < value.slowPeriod,
        "strategy.params.fastPeriod must be strictly less than slowPeriod"
      ),
  }),
  risk: z
    .object({
      initialCapital: z
        .number({ required_error: "risk.initialCapital is required" })
        .positive(),
      quantity: z.number().int().positive().optional(),
      commissionPerTrade: z.number().min(0).optional(),
      slippageBps: z.number().min(0).optional(),
    })
    .default({ initialCapital: 10_000 }),
});

/**
 * Executes a deterministic SMA crossover backtest and persists the run so it can
 * be surfaced as an artefact or revisited later on.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = now();
  const clientKey = resolveClientKey(request);

  try {
    assertFinanceFeatureEnabled();
    const rateLimit = enforceRateLimit({
      key: `finance:backtest:${clientKey}`,
      limit: 15,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      throw new ChatSDKError(
        "rate_limit:api",
        "Finance backtest quota exceeded for this client."
      );
    }

    let json: unknown;

    try {
      json = await request.json();
    } catch {
      throw new ChatSDKError("bad_request:api", "Request body must be valid JSON.");
    }

    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new ChatSDKError("bad_request:api", detail);
    }

    const payload = parsed.data;
    const metadata = assertSupportedSymbol(payload.symbol);
    const timeframe = payload.timeframe;

    const session = await auth();

    if (!session?.user) {
      throw new ChatSDKError(
        "unauthorized:auth",
        "You must be signed in to run backtests."
      );
    }

    const series = FINANCE_SERIES[metadata.symbol];
    const fromEpoch = payload.period.from;
    const toEpoch = payload.period.to;
    const maxSpanSeconds = MAX_BACKTEST_RANGE_DAYS * SECONDS_PER_DAY;
    const requestedSpanSeconds = toEpoch - fromEpoch;

    if (requestedSpanSeconds > maxSpanSeconds) {
      throw new ChatSDKError(
        "bad_request:api",
        `Requested period exceeds the maximum supported duration of ${MAX_BACKTEST_RANGE_DAYS} days.`
      );
    }

    const range = resolveRange(series, fromEpoch, toEpoch);
    const candles = series.filter(
      (candle) => candle.timestamp >= range.from && candle.timestamp <= range.to
    );

    if (candles.length === 0) {
      throw new ChatSDKError(
        "bad_request:api",
        "No historical candles matched the requested period."
      );
    }

    const backtestParams: BacktestParameters = {
      strategy: {
        type: "sma-crossover",
        params: {
          fastPeriod: payload.strategy.params.fastPeriod,
          slowPeriod: payload.strategy.params.slowPeriod,
        },
      },
      risk: {
        initialCapital: payload.risk.initialCapital,
        quantity: payload.risk.quantity,
        commissionPerTrade: payload.risk.commissionPerTrade,
        slippageBps: payload.risk.slippageBps,
      },
    };

    const result = runBacktest(candles, backtestParams);

    const assetRecord = await upsertAsset({
      symbol: metadata.symbol,
      exchange: metadata.exchange,
      type: metadata.type,
      name: metadata.name,
      currency: metadata.currency,
    });

    let strategyId = payload.strategy.strategyId;

    if (!strategyId) {
      const strategy = await createStrategy({
        userId: session.user.id,
        name: payload.strategy.name,
        description: payload.strategy.description,
      });
      strategyId = strategy.id;
    }

    const strategyVersion = await createStrategyVersion({
      strategyId,
      params: {
        timeframe,
        period: range,
        strategy: payload.strategy,
        risk: payload.risk,
      },
    });

    const run = await createBacktestRun({
      strategyVersionId: strategyVersion.id,
      assetId: assetRecord.id,
      timeframe,
      periodStart: new Date(range.from * 1000),
      periodEnd: new Date(range.to * 1000),
      metrics: result.metrics,
      trades: result.trades,
      equityCurve: result.equityCurve,
    });

    return Response.json({
      type: "finance.backtest",
      runId: run.id,
      symbol: metadata.symbol,
      timeframe,
      period: range,
      strategy: {
        id: strategyId,
        versionId: strategyVersion.id,
        name: payload.strategy.name,
        type: payload.strategy.type,
        params: payload.strategy.params,
        description: payload.strategy.description,
      },
      assetId: assetRecord.id,
      risk: payload.risk,
      metrics: result.metrics,
      trades: result.trades,
      equityCurve: result.equityCurve,
      rateLimit,
      source: "mock",
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    logError("api:finance.backtest", error, { clientKey });
    return Response.json(
      {
        error: {
          code: "internal_error:api",
          message: "Unexpected error while running backtest.",
        },
      },
      { status: 500 }
    );
  } finally {
    logRouteLatency("finance.backtest", startedAt, { clientKey });
  }
}
