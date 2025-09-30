import type {
  FinanceSymbol,
  FundamentalSnapshot,
  MockNewsItem,
} from "./mock-data";

/**
 * Core finance domain types shared across indicators, backtests, and API payloads.
 *
 * The goal is to keep the structures small, serialisable, and explicit so they
 * map nicely to persisted JSON artefacts and to data we might stream through the
 * agent pipeline. All timestamps are expressed as epoch seconds to stay
 * compatible with the lightweight-charts library and with the server-rendered
 * artefacts we plan to add later.
 */

/** Epoch-second timestamp used by OHLCV candles and derived series. */
export type CandleTimestamp = number;

/**
 * Represents a single OHLCV candle.
 *
 * When we request market history we always receive data in this shape. Having a
 * shared type allows the backtest engine, indicator helpers, and API mocks to
 * use the exact same interface without conversions.
 */
export interface OHLCV {
  /** Time of the candle expressed as epoch seconds. */
  readonly timestamp: CandleTimestamp;
  /** Asset price at the open of the candle. */
  readonly open: number;
  /** Highest traded price during the candle. */
  readonly high: number;
  /** Lowest traded price during the candle. */
  readonly low: number;
  /** Closing price of the candle. */
  readonly close: number;
  /** Volume traded during the candle (units depend on the asset). */
  readonly volume: number;
}

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
export interface BacktestTrade {
  /** Epoch-second timestamp when the position was opened. */
  readonly entryTimestamp: CandleTimestamp;
  /** Price used to enter the position after slippage/fees. */
  readonly entryPrice: number;
  /** Epoch-second timestamp when the position was closed. */
  readonly exitTimestamp: CandleTimestamp;
  /** Price used to exit the position after slippage/fees. */
  readonly exitPrice: number;
  /** Quantity of units traded. Long-only strategies use positive quantities. */
  readonly quantity: number;
  /** Gross profit or loss realised by the trade (before fees). */
  readonly grossPnl: number;
  /** Net profit or loss after fees/commissions. */
  readonly netPnl: number;
}

/** Point on the equity curve produced after processing a candle. */
export interface EquityCurvePoint {
  /** Timestamp of the candle that produced this balance. */
  readonly timestamp: CandleTimestamp;
  /** Account equity after marking the open positions to market. */
  readonly equity: number;
}

/** Summary metrics describing the performance of a backtest run. */
export interface BacktestMetrics {
  /** Total return expressed as a decimal (0.25 = +25%). */
  readonly totalReturn: number;
  /** Compound annual growth rate as a decimal. */
  readonly cagr: number;
  /** Maximum peak-to-trough drawdown encountered during the run. */
  readonly maxDrawdown: number;
  /** Ratio of winning trades to total closed trades. */
  readonly winRate: number;
  /** Average profit for winning trades. */
  readonly averageWin: number;
  /** Average loss for losing trades (absolute value). */
  readonly averageLoss: number;
  /** Sharpe ratio using daily returns and zero risk-free rate. */
  readonly sharpe: number;
  /** Profit factor defined as gross profit divided by gross loss. */
  readonly profitFactor: number;
  /** Number of closed trades. */
  readonly trades: number;
}

/** Configuration for a simple moving-average crossover strategy. */
export interface SmaCrossoverParameters {
  /** Period for the fast moving average. */
  readonly fastPeriod: number;
  /** Period for the slow moving average. */
  readonly slowPeriod: number;
}

/** Risk management knobs supported by the backtest engine. */
export interface RiskParameters {
  /** Fixed position size (units). If omitted the engine derives from capital. */
  readonly quantity?: number;
  /** Amount of capital allocated at the start of the backtest. */
  readonly initialCapital: number;
  /** Per-trade commission applied on entry and exit. */
  readonly commissionPerTrade?: number;
  /** Additional slippage expressed in basis points. */
  readonly slippageBps?: number;
}

/** Supported strategy parameterisation for the backtest engine. */
export interface BacktestParameters {
  /** Currently only SMA crossover is implemented but more can be added. */
  readonly strategy: {
    readonly type: "sma-crossover";
    readonly params: SmaCrossoverParameters;
  };
  /** Risk configuration controlling sizing and costs. */
  readonly risk: RiskParameters;
}

/** Result returned by the backtest engine. */
export interface BacktestResult {
  readonly trades: BacktestTrade[];
  readonly equityCurve: EquityCurvePoint[];
  readonly metrics: BacktestMetrics;
}

/** Structure representing a candlestick or price action pattern. */
export interface CandlestickPattern {
  /** Identifier of the detected pattern (e.g. `hammer`, `bullish_engulfing`). */
  readonly name: string;
  /** Short explanation to display inside artefacts. */
  readonly explanation: string;
}

/** Output element describing where a given pattern has been detected. */
export interface PatternDetection {
  readonly index: number;
  readonly timestamp: CandleTimestamp;
  readonly pattern: CandlestickPattern;
}

/** Simple structure representing a support or resistance level. */
export interface SupportResistanceLevel {
  readonly type: "support" | "resistance";
  readonly price: number;
  readonly fromTimestamp: CandleTimestamp;
  readonly toTimestamp: CandleTimestamp;
}

/** Quote information returned by the market data adapter. */
export interface Quote {
  readonly symbol: string;
  readonly price: number;
  readonly timestamp: CandleTimestamp;
}

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

/**
 * Snapshot of an overlay series (e.g. SMA/EMA) rendered alongside OHLC candles
 * in the finance chart artefact. Values may be `null` for the first candles
 * until the rolling window is fully populated.
 */
export interface FinanceOverlaySeriesPoint {
  readonly t: CandleTimestamp;
  readonly v: number | null;
}

/** Metadata describing a computed overlay rendered on the price chart. */
export interface FinanceOverlaySeries {
  readonly type: "sma" | "ema";
  readonly length: number;
  readonly values: readonly FinanceOverlaySeriesPoint[];
}

/** Canonical representation of the price history artefact streamed to the UI. */
export interface FinanceChartArtifact {
  readonly type: "finance.chart";
  readonly symbol: FinanceSymbol;
  readonly timeframe: string;
  readonly range: {
    readonly from: string;
    readonly to: string;
  };
  readonly ohlcv: readonly {
    readonly t: CandleTimestamp;
    readonly o: number;
    readonly h: number;
    readonly l: number;
    readonly c: number;
    readonly v: number;
  }[];
  readonly overlays: readonly FinanceOverlaySeries[];
}

/**
 * Overlay describing detected patterns and support/resistance levels for a
 * chart that has already been fetched.
 */
export interface FinanceChartAnnotationsArtifact {
  readonly type: "finance.chart.annotations";
  readonly symbol: FinanceSymbol;
  readonly timeframe: string;
  readonly patterns: readonly {
    readonly name: string;
    readonly explanation: string;
    readonly timestamp: CandleTimestamp;
    readonly index: number;
  }[];
  readonly levels: readonly {
    readonly type: "support" | "resistance";
    readonly price: number;
    readonly from: CandleTimestamp;
    readonly to: CandleTimestamp;
  }[];
}

/** Snapshot of mocked fundamentals displayed in the artefact workspace. */
export interface FinanceFundamentalsArtifact {
  readonly type: "finance.fundamentals";
  readonly symbol: FinanceSymbol;
  readonly snapshot: FundamentalSnapshot;
  readonly highlights: readonly string[];
  readonly caution?: string;
}

/** News headlines artefact used to contextualise the analysis. */
export interface FinanceNewsArtifact {
  readonly type: "finance.news";
  readonly symbol: FinanceSymbol;
  readonly items: readonly MockNewsItem[];
}

/**
 * Aggregated payload produced by the TypeScript backtest engine and streamed as
 * an artefact. The UI will render metrics, equity curve, and trades.
 */
export interface FinanceBacktestArtifact {
  readonly type: "finance.backtest";
  readonly runId: string;
  readonly symbol: FinanceSymbol;
  readonly timeframe: string;
  readonly period: {
    readonly from: string;
    readonly to: string;
  };
  readonly strategy: BacktestParameters["strategy"];
  readonly metrics: BacktestMetrics;
  readonly equityCurve: readonly {
    readonly t: CandleTimestamp;
    readonly e: number;
  }[];
  readonly trades: readonly BacktestTrade[];
  readonly commentary?: string;
}

/** Simple artefact representing screen results (used mainly for debugging). */
export interface FinanceScreenArtifact {
  readonly type: "finance.screen";
  readonly results: readonly {
    readonly symbol: FinanceSymbol;
    readonly marketCap: number;
    readonly peRatio: number;
  }[];
}

/** Union of every finance artefact emitted by the toolchain. */
export type FinanceArtifact =
  | FinanceChartArtifact
  | FinanceChartAnnotationsArtifact
  | FinanceFundamentalsArtifact
  | FinanceNewsArtifact
  | FinanceBacktestArtifact
  | FinanceScreenArtifact;
