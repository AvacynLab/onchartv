import { randomUUID } from "node:crypto";

import { tool } from "ai";
import { z } from "zod";

import { runBacktest } from "@/lib/finance/backtest/engine";
import { InMemoryMarketDataAdapter } from "@/lib/finance/data-adapter";
import {
  FINANCE_SERIES,
  FINANCE_SYMBOLS,
  FUNDAMENTAL_SNAPSHOTS,
  NEWS_ITEMS,
} from "@/lib/finance/mock-data";
import {
  calculateEMA,
  calculateSMA,
} from "@/lib/finance/indicators";
import {
  detectCandlestickPatterns,
  detectSupportResistanceLevels,
} from "@/lib/finance/patterns";
import type {
  BacktestParameters,
  FinanceArtifact,
  MarketDataAdapter,
  OHLCV,
} from "@/lib/finance/types";
import {
  DEFAULT_FINANCE_PREFERENCES,
  type FinancePreferences,
} from "@/lib/finance/preferences";

const MAX_CHART_CANDLES = 1_500;
const MAX_OVERLAYS = 5;
const DEFAULT_CHART_LIMIT = 200;

const timeframeSchema = z.enum(["1D"], {
  errorMap: () => ({
    message: "Only daily candles are supported by the offline market adapter.",
  }),
});

const isoDateString = z.string().refine(
  (value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp);
  },
  {
    message: "Expected an ISO-8601 timestamp (e.g. 2024-01-01T00:00:00Z).",
  }
);

const candleSchema = z.object({
  t: z.number().int(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});

const overlaySchema = z.object({
  type: z.enum(["sma", "ema"], {
    errorMap: () => ({
      message: "Only SMA and EMA overlays are supported at the moment.",
    }),
  }),
  length: z
    .number()
    .int()
    .min(2, "Indicator length must be at least two periods.")
    .max(500, "Indicator length cannot exceed 500 periods."),
});

const chartFetchInputSchema = z.object({
  symbol: z.enum(FINANCE_SYMBOLS),
  timeframe: timeframeSchema.default("1D"),
  from: isoDateString.optional(),
  to: isoDateString.optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(
      MAX_CHART_CANDLES,
      `Cannot request more than ${MAX_CHART_CANDLES} candles in a single call.`
    )
    .optional(),
  overlays: z
    .array(overlaySchema)
    .max(
      MAX_OVERLAYS,
      `A maximum of ${MAX_OVERLAYS} indicator overlays can be requested.`
    )
    .optional(),
});

const chartAnnotateInputSchema = z.object({
  symbol: z.enum(FINANCE_SYMBOLS),
  timeframe: timeframeSchema.default("1D"),
  candles: z
    .array(candleSchema)
    .min(50, "At least 50 candles are required to analyse price action.")
    .max(
      MAX_CHART_CANDLES,
      `Cannot annotate more than ${MAX_CHART_CANDLES} candles at once.`
    ),
});

const fundamentalsInputSchema = z.object({
  symbol: z.enum(FINANCE_SYMBOLS),
});

const newsFetchInputSchema = z.object({
  symbol: z.enum(FINANCE_SYMBOLS),
  limit: z
    .number()
    .int()
    .positive()
    .max(20, "News pagination is capped to 20 headlines.")
    .default(5),
});

const backtestInputSchema = z.object({
  symbol: z.enum(FINANCE_SYMBOLS),
  timeframe: timeframeSchema.default("1D"),
  range: z.object({
    from: isoDateString,
    to: isoDateString,
  }),
  strategy: z.object({
    type: z.literal("sma-crossover"),
    params: z.object({
      fastPeriod: z
        .number()
        .int()
        .min(2, "Fast period must be at least two candles."),
      slowPeriod: z
        .number()
        .int()
        .min(3, "Slow period must be at least three candles."),
    }),
  }),
  risk: z.object({
    initialCapital: z
      .number()
      .positive("Initial capital must be a positive amount."),
    quantity: z
      .number()
      .int()
      .positive("Trade size must be positive when specified.")
      .optional(),
    commissionPerTrade: z
      .number()
      .min(0, "Commission cannot be negative.")
      .optional(),
    slippageBps: z
      .number()
      .min(0, "Slippage cannot be negative.")
      .max(1_000, "Slippage above 1000 bps (10%) is not supported.")
      .optional(),
  }),
});

const screenInputSchema = z.object({
  filters: z
    .object({
      minMarketCap: z
        .number()
        .min(0, "Market capitalisation filter cannot be negative.")
        .optional(),
      maxPeRatio: z
        .number()
        .min(0, "PE ratio filter cannot be negative.")
        .optional(),
      assetTypes: z
        .array(z.enum(["equity", "crypto", "fx"]))
        .max(3)
        .optional(),
    })
    .default({}),
});

export const financeToolSchemas = {
  chartFetch: chartFetchInputSchema,
  chartAnnotate: chartAnnotateInputSchema,
  fundamentalsFetch: fundamentalsInputSchema,
  newsFetch: newsFetchInputSchema,
  strategyBacktest: backtestInputSchema,
  screen: screenInputSchema,
};

/**
 * Lightweight logger interface that records the intent of each finance tool
 * execution without leaking sensitive payloads. The default implementation
 * delegates to `console.info` to keep things observable in development.
 */
interface FinanceToolLogger {
  readonly info: (message: string, metadata?: Record<string, unknown>) => void;
}

interface CreateFinanceToolsOptions {
  readonly marketData?: MarketDataAdapter;
  readonly logger?: FinanceToolLogger;
  readonly idFactory?: () => string;
  readonly onArtifact?: (artifact: FinanceArtifact) => void;
  readonly preferences?: FinancePreferences;
}

function toEpochSeconds(value: string): number {
  return Math.floor(Date.parse(value) / 1_000);
}

function toIsoString(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString();
}

function normaliseCandles(raw: ReadonlyArray<{
  readonly t: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
}>): OHLCV[] {
  return raw.map((candle) => ({
    timestamp: candle.t,
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v,
  }));
}

function mapOverlaySeries(
  candles: OHLCV[],
  overlay: z.infer<typeof overlaySchema>
) {
  const closes = candles.map((candle) => candle.close);
  const calculator = overlay.type === "sma" ? calculateSMA : calculateEMA;
  const values = calculator(closes, { period: overlay.length });

  return {
    type: overlay.type,
    length: overlay.length,
    values: values.map((value, index) => ({
      t: candles[index]?.timestamp ?? 0,
      v: value,
    })),
  } as const;
}

function createDefaultLogger(): FinanceToolLogger {
  return {
    info: (message, metadata) => {
      console.info(`[finance.tools] ${message}`, metadata ?? {});
    },
  };
}

/**
 * Builds the full set of finance-oriented tools exposed to the AI provider. A
 * dependency injection hook keeps the helpers deterministic during unit tests
 * while still allowing integration with real market data adapters later on.
 */
export function createFinanceTools(
  options: CreateFinanceToolsOptions = {}
) {
  const marketData =
    options.marketData ?? new InMemoryMarketDataAdapter(FINANCE_SERIES);
  const logger = options.logger ?? createDefaultLogger();
  const idFactory = options.idFactory ?? randomUUID;
  const preferences = options.preferences ?? DEFAULT_FINANCE_PREFERENCES;
  const emitArtifact = <T extends FinanceArtifact>(artifact: T): T => {
    options.onArtifact?.(artifact);
    return artifact;
  };

  const chartFetch = tool({
    description:
      "Récupère une série OHLCV hermétique pour alimenter les artefacts de graphique.",
    inputSchema: chartFetchInputSchema,
    execute: async (input) => {
      const limit = input.limit ?? DEFAULT_CHART_LIMIT;
      const timeframe = input.timeframe;
      const to = input.to ? toEpochSeconds(input.to) : Number.POSITIVE_INFINITY;
      const secondsPerCandle = 86_400; // daily candles
      const seedSeries = FINANCE_SERIES[input.symbol];
      const latestSeedTimestamp = seedSeries
        ? seedSeries[seedSeries.length - 1]?.timestamp
        : undefined;
      const fallbackTo =
        to === Number.POSITIVE_INFINITY
          ? latestSeedTimestamp ?? Math.floor(Date.now() / 1_000)
          : to;
      const from = input.from
        ? toEpochSeconds(input.from)
        : Math.floor(fallbackTo - limit * secondsPerCandle);

      const candles = await marketData.history({
        symbol: input.symbol,
        timeframe,
        from,
        to: to === Number.POSITIVE_INFINITY ? Math.floor(fallbackTo) : to,
        limit,
      });

      if (candles.length === 0) {
        throw new Error(
          `Aucune donnée disponible pour ${input.symbol} sur la période demandée.`
        );
      }

      const overlays = (input.overlays ?? []).map((overlay) =>
        mapOverlaySeries(candles, overlay)
      );

      logger.info("chart.fetch", {
        symbol: input.symbol,
        timeframe,
        candles: candles.length,
        overlays: overlays.length,
      });

      return emitArtifact({
        type: "finance.chart" as const,
        symbol: input.symbol,
        timeframe,
        range: {
          from: toIsoString(candles[0].timestamp),
          to: toIsoString(candles[candles.length - 1].timestamp),
        },
        ohlcv: candles.map((candle) => ({
          t: candle.timestamp,
          o: candle.open,
          h: candle.high,
          l: candle.low,
          c: candle.close,
          v: candle.volume,
        })),
        overlays,
      });
    },
  });

  const chartAnnotate = tool({
    description:
      "Analyse une série OHLCV pour détecter motifs et zones de support/résistance.",
    inputSchema: chartAnnotateInputSchema,
    execute: async (input) => {
      const candles = normaliseCandles(input.candles);
      const patterns = detectCandlestickPatterns(candles);
      const levels = detectSupportResistanceLevels(candles);

      logger.info("chart.annotate", {
        symbol: input.symbol,
        timeframe: input.timeframe,
        candles: candles.length,
        patterns: patterns.length,
        levels: levels.length,
      });

      return emitArtifact({
        type: "finance.chart.annotations" as const,
        symbol: input.symbol,
        timeframe: input.timeframe,
        patterns: patterns.map((pattern) => ({
          name: pattern.pattern.name,
          explanation: pattern.pattern.explanation,
          timestamp: pattern.timestamp,
          index: pattern.index,
        })),
        levels: levels.map((level) => ({
          type: level.type,
          price: level.price,
          from: level.fromTimestamp,
          to: level.toTimestamp,
        })),
      });
    },
  });

  const fundamentalsFetch = tool({
    description:
      "Retourne des ratios fondamentaux synthétiques pour un actif supporté.",
    inputSchema: fundamentalsInputSchema,
    execute: async ({ symbol }) => {
      const fundamentals = FUNDAMENTAL_SNAPSHOTS[symbol];

      if (!fundamentals) {
        throw new Error(`Aucun fondamentaux synthétique n'est disponible pour ${symbol}.`);
      }

      logger.info("fundamentals.fetch", { symbol });

      const highlights: string[] = [];

      if (fundamentals.peRatio > 0) {
        highlights.push(
          `Ratio cours/bénéfices estimé à ${fundamentals.peRatio.toFixed(
            1
          )}, comparé au secteur tech large-cap.`
        );
      }

      if (fundamentals.dividendYield > 0) {
        highlights.push(
          `Rendement du dividende proche de ${(fundamentals.dividendYield * 100).toFixed(
            2
          )} %.`
        );
      }

      if (fundamentals.grossMargin > 0) {
        highlights.push(
          `Marge brute de ${(fundamentals.grossMargin * 100).toFixed(
            1
          )} %, signe d'un pricing power solide.`
        );
      }

      return emitArtifact({
        type: "finance.fundamentals" as const,
        symbol,
        snapshot: fundamentals,
        highlights,
        caution:
          symbol === "BTCUSD" || symbol === "ETHUSD"
            ? "Les crypto-actifs ne disposent pas d'états financiers traditionnels; les métriques sont indicatives."
            : undefined,
      });
    },
  });

  const newsFetch = tool({
    description:
      "Liste des gros titres synthétiques (sentiment + résumé) pour un actif.",
    inputSchema: newsFetchInputSchema,
    execute: async ({ symbol, limit }) => {
      const entries = NEWS_ITEMS.filter((item) => item.symbol === symbol)
        .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
        .slice(0, limit);

      const items = preferences.showNews ? entries : [];

      logger.info("news.fetch", {
        symbol,
        headlines: entries.length,
        delivered: items.length,
        suppressed: preferences.showNews === false,
      });

      if (!preferences.showNews) {
        logger.info("news.fetch.suppressed", {
          reason: "preferences", // keeps structured log analyzable
          symbol,
        });
      }

      return emitArtifact({
        type: "finance.news" as const,
        symbol,
        items,
      });
    },
  });

  const strategyBacktest = tool({
    description:
      "Exécute un backtest SMA crossover hermétique et retourne métriques + trades.",
    inputSchema: backtestInputSchema,
    execute: async (input) => {
      const from = toEpochSeconds(input.range.from);
      const to = toEpochSeconds(input.range.to);

      if (from >= to) {
        throw new Error("La date de début doit précéder la date de fin.");
      }

      const candles = await marketData.history({
        symbol: input.symbol,
        timeframe: input.timeframe,
        from,
        to,
      });

      if (candles.length < input.strategy.params.slowPeriod) {
        throw new Error(
          "Historique insuffisant pour calculer les moyennes mobiles demandées."
        );
      }

      const parameters: BacktestParameters = {
        strategy: input.strategy,
        risk: input.risk,
      };

      const result = runBacktest(candles, parameters);

      logger.info("strategy.backtest", {
        symbol: input.symbol,
        timeframe: input.timeframe,
        candles: candles.length,
        trades: result.trades.length,
      });

      return emitArtifact({
        type: "finance.backtest" as const,
        runId: idFactory(),
        symbol: input.symbol,
        timeframe: input.timeframe,
        period: {
          from: input.range.from,
          to: input.range.to,
        },
        strategy: input.strategy,
        metrics: result.metrics,
        equityCurve: result.equityCurve.map((point) => ({
          t: point.timestamp,
          e: point.equity,
        })),
        trades: result.trades,
        commentary:
          result.metrics.trades === 0
            ? "Aucun croisement exploitable détecté sur la période – stratégie restée en cash."
            : "Stratégie exécutée avec succès; examiner les trades clés et le drawdown pour contextualiser la performance.",
      });
    },
  });

  const screenAssets = tool({
    description:
      "Filtre le catalogue synthétique (market cap, PE, type d'actif).",
    inputSchema: screenInputSchema,
    execute: async ({ filters }) => {
      const { minMarketCap, maxPeRatio, assetTypes } = filters;

      const matches = Object.values(FUNDAMENTAL_SNAPSHOTS)
        .filter((entry) => {
          if (typeof minMarketCap === "number" && entry.marketCap < minMarketCap) {
            return false;
          }
          if (typeof maxPeRatio === "number" && entry.peRatio > 0 && entry.peRatio > maxPeRatio) {
            return false;
          }
          if (assetTypes && assetTypes.length > 0) {
            if (assetTypes.includes("crypto") && (entry.symbol === "BTCUSD" || entry.symbol === "ETHUSD")) {
              return true;
            }
            if (assetTypes.includes("fx") && entry.symbol === "EURUSD") {
              return true;
            }
            if (assetTypes.includes("equity") && (entry.symbol === "AAPL" || entry.symbol === "NVDA")) {
              return true;
            }
            return false;
          }
          return true;
        })
        .map((entry) => ({
          symbol: entry.symbol,
          marketCap: entry.marketCap,
          peRatio: entry.peRatio,
        }));

      logger.info("screen", { results: matches.length, filters });

      return emitArtifact({
        type: "finance.screen" as const,
        results: matches,
      });
    },
  });

  return {
    chartFetch,
    chartAnnotate,
    fundamentalsFetch,
    newsFetch,
    strategyBacktest,
    screenAssets,
  };
}

export type FinanceTools = ReturnType<typeof createFinanceTools>;

/**
 * Default singleton exported for application code. Consumers that require
 * dependency injection (e.g. tests) can call `createFinanceTools` manually.
 */
export const financeTools = createFinanceTools();
