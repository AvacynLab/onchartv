import { z } from "zod";

import { FINANCE_SYMBOLS } from "./mock-data";

/**
 * Core finance domain types shared across indicators, backtests, and API payloads.
 *
 * The goal is to keep the structures small, serialisable, and explicit so they
 * map nicely to persisted JSON artefacts and to data we might stream through the
 * agent pipeline. All timestamps are expressed as epoch seconds to stay
 * compatible with the lightweight-charts library and with the server-rendered
 * artefacts we plan to add later.
 */

/**
 * Literal union of supported finance symbols derived from the offline catalogue.
 * Keeping the schema here allows both runtime validation and type inference via
 * `z.infer`, ensuring every consumer relies on the same discriminant values.
 */
const financeSymbolLiterals = [...FINANCE_SYMBOLS] as [
  (typeof FINANCE_SYMBOLS)[number],
  ...((typeof FINANCE_SYMBOLS)[number])[],
];

/** Zod schema describing all supported finance symbols. */
export const financeSymbolSchema = z.enum(financeSymbolLiterals);

/** Runtime-safe union of supported finance symbols. */
export type FinanceSymbol = z.infer<typeof financeSymbolSchema>;

/** Epoch-second timestamp used by OHLCV candles and derived series. */
export const candleTimestampSchema = z
  .number({ invalid_type_error: "timestamp must be a number" })
  .int({ message: "timestamp must be an integer" });

/** Runtime-safe alias for candle timestamps. */
export type CandleTimestamp = z.infer<typeof candleTimestampSchema>;

/**
 * Represents a single OHLCV candle.
 *
 * When we request market history we always receive data in this shape. Having a
 * shared type allows the backtest engine, indicator helpers, and API mocks to
 * use the exact same interface without conversions.
 */
export const ohlcvSchema = z.object({
  /** Time of the candle expressed as epoch seconds. */
  timestamp: candleTimestampSchema,
  /** Asset price at the open of the candle. */
  open: z.number({ invalid_type_error: "open must be a number" }),
  /** Highest traded price during the candle. */
  high: z.number({ invalid_type_error: "high must be a number" }),
  /** Lowest traded price during the candle. */
  low: z.number({ invalid_type_error: "low must be a number" }),
  /** Closing price of the candle. */
  close: z.number({ invalid_type_error: "close must be a number" }),
  /** Volume traded during the candle (units depend on the asset). */
  volume: z.number({ invalid_type_error: "volume must be a number" }),
});

/** Runtime type alias describing a single OHLCV candle. */
export type OHLCV = z.infer<typeof ohlcvSchema>;

/**
 * Base representation of a derived numeric series where some early values may
 * be missing until the rolling window is populated. `null` is used instead of
 * `undefined` so the array remains serialisable when stored in JSON columns.
 */
export type NullableNumericSeries = Array<number | null>;

/**
 * Representation of the upper/middle/lower Bollinger band values. The middle
 * band is always the corresponding moving average and mirrors the SMA output.
 */
export interface BollingerBandsPoint {
  /** Timestamp of the candle used for the calculation. */
  readonly timestamp: CandleTimestamp;
  /** Middle band (simple moving average). */
  readonly middle: number | null;
  /** Upper band value or `null` when insufficient data is available. */
  readonly upper: number | null;
  /** Lower band value or `null` when insufficient data is available. */
  readonly lower: number | null;
}

/**
 * Helper describing numeric series calculations. Keeping it generic allows us
 * to re-use these helpers for other rolling window indicators.
 */
export interface SeriesComputationOptions {
  /**
   * Number of periods used by the rolling window. Validation is performed by
   * the helpers and must be greater than zero.
   */
  readonly period: number;
}

/** Options accepted by the Bollinger bands helper. */
export interface BollingerBandsOptions extends SeriesComputationOptions {
  /**
   * Standard deviation multiplier applied to the distance between the middle
   * band and the upper/lower bands. The canonical value is 2.
   */
  readonly standardDeviations?: number;
}

/** Input series accepted by the indicator helpers. */
export type PriceSeries = ReadonlyArray<number>;

/** Candle series accepted by helpers that need the full OHLCV context. */
export type CandleSeries = ReadonlyArray<OHLCV>;

/**
 * Shape of an individual trade produced by the backtest engine.
 *
 * Values are stored in raw numeric form so they can be serialised in artefacts
 * and persisted in JSON columns without further transformation. All monetary
 * values are expressed in quote currency units.
 */
export const backtestTradeSchema = z.object({
  /** Epoch-second timestamp when the position was opened. */
  entryTimestamp: candleTimestampSchema,
  /** Price used to enter the position after slippage/fees. */
  entryPrice: z.number({ invalid_type_error: "entryPrice must be a number" }),
  /** Epoch-second timestamp when the position was closed. */
  exitTimestamp: candleTimestampSchema,
  /** Price used to exit the position after slippage/fees. */
  exitPrice: z.number({ invalid_type_error: "exitPrice must be a number" }),
  /** Quantity of units traded. Long-only strategies use positive quantities. */
  quantity: z.number({ invalid_type_error: "quantity must be a number" }),
  /** Gross profit or loss realised by the trade (before fees). */
  grossPnl: z.number({ invalid_type_error: "grossPnl must be a number" }),
  /** Net profit or loss after fees/commissions. */
  netPnl: z.number({ invalid_type_error: "netPnl must be a number" }),
});

/** Runtime type alias describing a single backtest trade. */
export type BacktestTrade = z.infer<typeof backtestTradeSchema>;

/** Point on the equity curve produced after processing a candle. */
export const equityCurvePointSchema = z.object({
  /** Timestamp of the candle that produced this balance. */
  timestamp: candleTimestampSchema,
  /** Account equity after marking the open positions to market. */
  equity: z.number({ invalid_type_error: "equity must be a number" }),
});

/** Runtime alias for equity curve entries. */
export type EquityCurvePoint = z.infer<typeof equityCurvePointSchema>;

/** Summary metrics describing the performance of a backtest run. */
export const backtestMetricsSchema = z.object({
  /** Total return expressed as a decimal (0.25 = +25%). */
  totalReturn: z.number({ invalid_type_error: "totalReturn must be a number" }),
  /** Compound annual growth rate as a decimal. */
  cagr: z.number({ invalid_type_error: "cagr must be a number" }),
  /** Maximum peak-to-trough drawdown encountered during the run. */
  maxDrawdown: z.number({ invalid_type_error: "maxDrawdown must be a number" }),
  /** Ratio of winning trades to total closed trades. */
  winRate: z.number({ invalid_type_error: "winRate must be a number" }),
  /** Average profit for winning trades. */
  averageWin: z.number({ invalid_type_error: "averageWin must be a number" }),
  /** Average loss for losing trades (absolute value). */
  averageLoss: z.number({ invalid_type_error: "averageLoss must be a number" }),
  /** Sharpe ratio using daily returns and zero risk-free rate. */
  sharpe: z.number({ invalid_type_error: "sharpe must be a number" }),
  /** Profit factor defined as gross profit divided by gross loss. */
  profitFactor: z.number({ invalid_type_error: "profitFactor must be a number" }),
  /** Number of closed trades. */
  trades: z.number({ invalid_type_error: "trades must be a number" }).int(),
});

/** Runtime alias for backtest metrics. */
export type BacktestMetrics = z.infer<typeof backtestMetricsSchema>;

/** Configuration for a simple moving-average crossover strategy. */
export const smaCrossoverParametersSchema = z.object({
  /** Period for the fast moving average. */
  fastPeriod: z.number({ invalid_type_error: "fastPeriod must be a number" }),
  /** Period for the slow moving average. */
  slowPeriod: z.number({ invalid_type_error: "slowPeriod must be a number" }),
});

/** Runtime alias describing SMA crossover parameters. */
export type SmaCrossoverParameters = z.infer<
  typeof smaCrossoverParametersSchema
>;

/** Risk management knobs supported by the backtest engine. */
export const riskParametersSchema = z.object({
  /** Fixed position size (units). If omitted the engine derives from capital. */
  quantity: z
    .number({ invalid_type_error: "quantity must be a number" })
    .optional(),
  /** Amount of capital allocated at the start of the backtest. */
  initialCapital: z.number({ invalid_type_error: "initialCapital must be a number" }),
  /** Per-trade commission applied on entry and exit. */
  commissionPerTrade: z
    .number({ invalid_type_error: "commissionPerTrade must be a number" })
    .optional(),
  /** Additional slippage expressed in basis points. */
  slippageBps: z
    .number({ invalid_type_error: "slippageBps must be a number" })
    .optional(),
});

/** Runtime alias for risk parameter payloads. */
export type RiskParameters = z.infer<typeof riskParametersSchema>;

/** Strategy payload describing the active backtest configuration. */
export const backtestStrategySchema = z.object({
  type: z.literal("sma-crossover"),
  params: smaCrossoverParametersSchema,
});

/** Supported strategy parameterisation for the backtest engine. */
export const backtestParametersSchema = z.object({
  /** Currently only SMA crossover is implemented but more can be added. */
  strategy: backtestStrategySchema,
  /** Risk configuration controlling sizing and costs. */
  risk: riskParametersSchema,
});

/** Runtime alias for backtest parameter payloads. */
export type BacktestParameters = z.infer<typeof backtestParametersSchema>;

/** Result returned by the backtest engine. */
export const backtestResultSchema = z.object({
  trades: z.array(backtestTradeSchema),
  equityCurve: z.array(equityCurvePointSchema),
  metrics: backtestMetricsSchema,
});

/** Runtime alias for backtest engine results. */
export type BacktestResult = z.infer<typeof backtestResultSchema>;

/** Structure representing a candlestick or price action pattern. */
export const candlestickPatternSchema = z.object({
  /** Identifier of the detected pattern (e.g. `hammer`, `bullish_engulfing`). */
  name: z.string({ required_error: "pattern name is required" }),
  /** Short explanation to display inside artefacts. */
  explanation: z.string({ required_error: "pattern explanation is required" }),
});

/** Runtime alias for candlestick pattern payloads. */
export type CandlestickPattern = z.infer<typeof candlestickPatternSchema>;

/** Output element describing where a given pattern has been detected. */
export const patternDetectionSchema = z.object({
  index: z.number({ invalid_type_error: "index must be a number" }).int(),
  timestamp: candleTimestampSchema,
  pattern: candlestickPatternSchema,
});

/** Runtime alias for pattern detections. */
export type PatternDetection = z.infer<typeof patternDetectionSchema>;

/** Simple structure representing a support or resistance level. */
export const supportResistanceLevelSchema = z.object({
  type: z.union([z.literal("support"), z.literal("resistance")]),
  price: z.number({ invalid_type_error: "price must be a number" }),
  fromTimestamp: candleTimestampSchema,
  toTimestamp: candleTimestampSchema,
});

/** Runtime alias for support/resistance levels. */
export type SupportResistanceLevel = z.infer<
  typeof supportResistanceLevelSchema
>;

/** Quote information returned by the market data adapter. */
export const quoteSchema = z.object({
  symbol: z.string({ required_error: "symbol is required" }),
  price: z.number({ invalid_type_error: "price must be a number" }),
  timestamp: candleTimestampSchema,
});

/** Runtime alias for quote payloads. */
export type Quote = z.infer<typeof quoteSchema>;

/** Interface implemented by concrete market data providers (real or mock). */
export interface MarketDataAdapter {
  history(params: {
    readonly symbol: string;
    readonly timeframe: string;
    readonly from: CandleTimestamp;
    readonly to: CandleTimestamp;
    readonly limit?: number;
  }): Promise<OHLCV[]>;
  quote(params: { readonly symbol: string }): Promise<Quote>;
}

/** Fundamental metrics persisted in the offline catalogue. */
export const fundamentalSnapshotSchema = z.object({
  symbol: financeSymbolSchema,
  marketCap: z.number({ invalid_type_error: "marketCap must be a number" }),
  peRatio: z.number({ invalid_type_error: "peRatio must be a number" }),
  dividendYield: z.number({ invalid_type_error: "dividendYield must be a number" }),
  revenueTtm: z.number({ invalid_type_error: "revenueTtm must be a number" }),
  grossMargin: z.number({ invalid_type_error: "grossMargin must be a number" }),
  netMargin: z.number({ invalid_type_error: "netMargin must be a number" }),
  debtToEquity: z.number({ invalid_type_error: "debtToEquity must be a number" }),
});

/** Runtime alias for fundamental snapshots. */
export type FundamentalSnapshot = z.infer<typeof fundamentalSnapshotSchema>;

/** Mock news item structure exposed to the UI artefacts. */
export const mockNewsItemSchema = z.object({
  id: z.string({ required_error: "id is required" }),
  symbol: financeSymbolSchema,
  source: z.string({ required_error: "source is required" }),
  title: z.string({ required_error: "title is required" }),
  url: z.string({ required_error: "url is required" }),
  summary: z.string({ required_error: "summary is required" }),
  publishedAt: z.string({ required_error: "publishedAt is required" }),
  sentiment: z.union([
    z.literal("positive"),
    z.literal("neutral"),
    z.literal("negative"),
  ]),
});

/** Runtime alias for mock news items. */
export type MockNewsItem = z.infer<typeof mockNewsItemSchema>;

/**
 * Snapshot of an overlay series (e.g. SMA/EMA) rendered alongside OHLC candles
 * in the finance chart artefact. Values may be `null` for the first candles
 * until the rolling window is fully populated.
 */
export const financeOverlaySeriesPointSchema = z.object({
  t: candleTimestampSchema,
  v: z.number({ invalid_type_error: "overlay value must be numeric" }).nullable(),
});

/** Runtime alias for overlay points. */
export type FinanceOverlaySeriesPoint = z.infer<
  typeof financeOverlaySeriesPointSchema
>;

/** Metadata describing a computed overlay rendered on the price chart. */
export const financeOverlaySeriesSchema = z.object({
  type: z.union([z.literal("sma"), z.literal("ema")]),
  length: z.number({ invalid_type_error: "length must be a number" }).int(),
  values: z.array(financeOverlaySeriesPointSchema),
});

/** Runtime alias for overlay series metadata. */
export type FinanceOverlaySeries = z.infer<typeof financeOverlaySeriesSchema>;

/** Canonical representation of the price history artefact streamed to the UI. */
export const financeChartArtifactSchema = z.object({
  type: z.literal("finance.chart"),
  symbol: financeSymbolSchema,
  timeframe: z.string({ required_error: "timeframe is required" }),
  range: z.object({
    from: z.string({ required_error: "range.from is required" }),
    to: z.string({ required_error: "range.to is required" }),
  }),
  ohlcv: z.array(
    z.object({
      t: candleTimestampSchema,
      o: z.number({ invalid_type_error: "open must be numeric" }),
      h: z.number({ invalid_type_error: "high must be numeric" }),
      l: z.number({ invalid_type_error: "low must be numeric" }),
      c: z.number({ invalid_type_error: "close must be numeric" }),
      v: z.number({ invalid_type_error: "volume must be numeric" }),
    })
  ),
  overlays: z.array(financeOverlaySeriesSchema),
});

/** Runtime alias for the finance chart artefact. */
export type FinanceChartArtifact = z.infer<typeof financeChartArtifactSchema>;

/**
 * Overlay describing detected patterns and support/resistance levels for a
 * chart that has already been fetched.
 */
export const financeChartAnnotationsArtifactSchema = z.object({
  type: z.literal("finance.chart.annotations"),
  symbol: financeSymbolSchema,
  timeframe: z.string({ required_error: "timeframe is required" }),
  patterns: z.array(
    z.object({
      name: z.string({ required_error: "pattern name is required" }),
      explanation: z.string({ required_error: "pattern explanation is required" }),
      timestamp: candleTimestampSchema,
      index: z.number({ invalid_type_error: "index must be numeric" }).int(),
    })
  ),
  levels: z.array(
    z.object({
      type: z.union([z.literal("support"), z.literal("resistance")]),
      price: z.number({ invalid_type_error: "price must be numeric" }),
      from: candleTimestampSchema,
      to: candleTimestampSchema,
    })
  ),
});

/** Runtime alias for chart annotation artefacts. */
export type FinanceChartAnnotationsArtifact = z.infer<
  typeof financeChartAnnotationsArtifactSchema
>;

/** Snapshot of mocked fundamentals displayed in the artefact workspace. */
export const financeFundamentalsArtifactSchema = z.object({
  type: z.literal("finance.fundamentals"),
  symbol: financeSymbolSchema,
  snapshot: fundamentalSnapshotSchema,
  highlights: z.array(z.string()),
  caution: z.string().optional(),
});

/** Runtime alias for fundamentals artefacts. */
export type FinanceFundamentalsArtifact = z.infer<
  typeof financeFundamentalsArtifactSchema
>;

/** News headlines artefact used to contextualise the analysis. */
export const financeNewsArtifactSchema = z.object({
  type: z.literal("finance.news"),
  symbol: financeSymbolSchema,
  items: z.array(mockNewsItemSchema),
});

/** Runtime alias for news artefacts. */
export type FinanceNewsArtifact = z.infer<typeof financeNewsArtifactSchema>;

/**
 * Aggregated payload produced by the TypeScript backtest engine and streamed as
 * an artefact. The UI will render metrics, equity curve, and trades.
 */
/**
 * Normalise the `finance.backtest` period boundaries so persisted artefacts
 * remain readable even when upstream payloads provide epoch seconds. The schema
 * accepts either ISO strings (the format emitted by the chat tools) or numeric
 * epochs (observed in certain legacy API responses) and always returns a
 * trimmed ISO string.
 */
const buildBacktestPeriodBoundarySchema = (field: string) =>
  z
    .union([
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

          return trimmed;
        }),
      z
        .number({ required_error: `${field} is required` })
        .finite({ message: `${field} must be a finite number` })
        .transform((value) => {
          const normalised = Math.floor(value);
          return new Date(normalised * 1000).toISOString();
        }),
    ])
    .transform((value) => value);

export const financeBacktestArtifactSchema = z.object({
  type: z.literal("finance.backtest"),
  runId: z.string({ required_error: "runId is required" }),
  symbol: financeSymbolSchema,
  timeframe: z.string({ required_error: "timeframe is required" }),
  period: z.object({
    from: buildBacktestPeriodBoundarySchema("period.from"),
    to: buildBacktestPeriodBoundarySchema("period.to"),
  }),
  strategy: backtestStrategySchema,
  metrics: backtestMetricsSchema,
  equityCurve: z.array(
    z.object({
      t: candleTimestampSchema,
      e: z.number({ invalid_type_error: "equity must be numeric" }),
    })
  ),
  trades: z.array(backtestTradeSchema),
  commentary: z.string().optional(),
});

/** Runtime alias for backtest artefacts. */
export type FinanceBacktestArtifact = z.infer<
  typeof financeBacktestArtifactSchema
>;

/** Simple artefact representing screen results (used mainly for debugging). */
export const financeScreenArtifactSchema = z.object({
  type: z.literal("finance.screen"),
  results: z.array(
    z.object({
      symbol: financeSymbolSchema,
      marketCap: z.number({ invalid_type_error: "marketCap must be numeric" }),
      peRatio: z.number({ invalid_type_error: "peRatio must be numeric" }),
    })
  ),
});

/** Runtime alias for screen artefacts. */
export type FinanceScreenArtifact = z.infer<
  typeof financeScreenArtifactSchema
>;

/** Literal list of finance artefact discriminants for quick membership checks. */
export const FINANCE_ARTIFACT_TYPES = [
  "finance.chart",
  "finance.chart.annotations",
  "finance.fundamentals",
  "finance.news",
  "finance.backtest",
  "finance.screen",
] as const;

/** Zod schema covering every finance artefact emitted by the toolchain. */
export const financeArtifactSchema = z.discriminatedUnion("type", [
  financeChartArtifactSchema,
  financeChartAnnotationsArtifactSchema,
  financeFundamentalsArtifactSchema,
  financeNewsArtifactSchema,
  financeBacktestArtifactSchema,
  financeScreenArtifactSchema,
]);

/** Runtime alias for the discriminated finance artefact union. */
export type FinanceArtifact = z.infer<typeof financeArtifactSchema>;
