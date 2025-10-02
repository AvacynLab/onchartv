import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  assertSupportedSymbol,
  logRouteLatency,
  now,
  parseIsoToEpochSeconds,
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
import { enforceRateLimit } from "@/lib/ratelimit";
import type { BacktestParameters } from "@/lib/finance/types";

const SUPPORTED_TIMEFRAMES = ["1D"] as const;

const requestSchema = z.object({
  symbol: z
    .string({ required_error: "symbol is required" })
    .min(1, "symbol must not be empty"),
  timeframe: z.string().optional(),
  period: z.object({
    from: z
      .string({ required_error: "period.from is required" })
      .min(1, "period.from must not be empty"),
    to: z
      .string({ required_error: "period.to is required" })
      .min(1, "period.to must not be empty"),
  }),
  strategy: z.object({
    type: z.literal("sma-crossover"),
    name: z
      .string({ required_error: "strategy.name is required" })
      .min(1, "strategy.name must not be empty"),
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
    const rateLimit = enforceRateLimit({
      key: `finance:backtest:${clientKey}`,
      limit: 15,
      windowMs: 60_000,
    });

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
    const timeframe = (payload.timeframe ?? "1D").trim().toUpperCase();

    if (!SUPPORTED_TIMEFRAMES.includes(timeframe as (typeof SUPPORTED_TIMEFRAMES)[number])) {
      throw new ChatSDKError(
        "bad_request:api",
        `Unsupported timeframe '${payload.timeframe ?? ""}'. Only 1D candles are available in the offline catalogue.`
      );
    }

    const session = await auth();

    if (!session?.user) {
      throw new ChatSDKError(
        "unauthorized:auth",
        "You must be signed in to run backtests."
      );
    }

    const series = FINANCE_SERIES[metadata.symbol];
    const fromEpoch = parseIsoToEpochSeconds(payload.period.from, "period.from");
    const toEpoch = parseIsoToEpochSeconds(payload.period.to, "period.to");
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

    console.error("[api:finance.backtest] unexpected error", error);
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
