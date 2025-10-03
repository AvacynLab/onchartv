import {
  calculateEMA,
  calculateSMA,
} from "../indicators";
import {
  type BacktestParameters,
  type BacktestMetrics,
  type BacktestResult,
  type BacktestTrade,
  type CandleSeries,
  type EquityCurvePoint,
  type OHLCV,
} from "../types";

/** Basis points denominator (1 basis point = 0.01%). */
const BASIS_POINTS = 10_000;

/**
 * Internal representation of an open position. The engine currently supports a
 * single long position at a time which keeps the logic deterministic and simple
 * enough for unit tests while still mimicking typical retail backtests.
 */
interface OpenPosition {
  readonly entryTimestamp: number;
  readonly entryPrice: number;
  readonly quantity: number;
  readonly commissionPaid: number;
}

/**
 * Runs a backtest using a moving-average crossover strategy. This helper is the
 * main entry point exposed by the finance domain and returns the trades,
 * resulting equity curve, and aggregated performance metrics.
 */
export function runBacktest(
  candles: CandleSeries,
  parameters: BacktestParameters
): BacktestResult {
  if (candles.length === 0) {
    return {
      trades: [],
      equityCurve: [],
      metrics: {
        totalReturn: 0,
        cagr: 0,
        maxDrawdown: 0,
        winRate: 0,
        averageWin: 0,
        averageLoss: 0,
        sharpe: 0,
        profitFactor: 0,
        trades: 0,
      },
    };
  }

  if (parameters.strategy.type !== "sma-crossover") {
    throw new Error(
      `Unsupported strategy type: ${parameters.strategy.type}. Only 'sma-crossover' is implemented.`
    );
  }

  const { fastPeriod, slowPeriod } = parameters.strategy.params;
  const { initialCapital, quantity, commissionPerTrade = 0, slippageBps = 0 } =
    parameters.risk;

  if (initialCapital <= 0) {
    throw new Error("Initial capital must be positive.");
  }

  const closes = candles.map((candle) => candle.close);
  const fastMa = calculateEMA(closes, { period: fastPeriod });
  const slowMa = calculateSMA(closes, { period: slowPeriod });

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityCurvePoint[] = [];

  let cashBalance = initialCapital;
  let position: OpenPosition | null = null;
  let previousFast: number | null = null;
  let previousSlow: number | null = null;
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  const perPeriodReturns: number[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const fastValue = fastMa[index];
    const slowValue = slowMa[index];

    const hasPriorAverages = previousFast !== null && previousSlow !== null;
    const shouldEnter =
      position === null &&
      fastValue !== null &&
      slowValue !== null &&
      ((hasPriorAverages &&
        (previousFast as number) <= (previousSlow as number) &&
        fastValue > slowValue) ||
        (!hasPriorAverages && fastValue > slowValue));

    if (shouldEnter) {
      const fillPrice = applySlippage(candle.close, slippageBps, "buy");
      const tradeQuantity =
        quantity ?? Math.max(Math.floor(cashBalance / fillPrice), 0);

      if (tradeQuantity > 0) {
        const commission = commissionPerTrade;
        const cost = tradeQuantity * fillPrice + commission;

        if (cost <= cashBalance) {
          cashBalance -= cost;
          position = {
            entryTimestamp: candle.timestamp,
            entryPrice: fillPrice,
            quantity: tradeQuantity,
            commissionPaid: commission,
          };
        }
      }
    }

    const shouldExit =
      position !== null &&
      fastValue !== null &&
      slowValue !== null &&
      ((hasPriorAverages &&
        (previousFast as number) >= (previousSlow as number) &&
        fastValue < slowValue) ||
        (!hasPriorAverages && fastValue < slowValue));

    if (shouldExit && position) {
      const exitFill = applySlippage(candle.close, slippageBps, "sell");
      const commission = commissionPerTrade;
      const proceeds = position.quantity * exitFill - commission;
      cashBalance += proceeds;

      const grossPnl = (exitFill - position.entryPrice) * position.quantity;
      const netPnl = grossPnl - (position.commissionPaid + commission);

      trades.push({
        entryTimestamp: position.entryTimestamp,
        entryPrice: roundToTwoDecimals(position.entryPrice),
        exitTimestamp: candle.timestamp,
        exitPrice: roundToTwoDecimals(exitFill),
        quantity: position.quantity,
        grossPnl: roundToTwoDecimals(grossPnl),
        netPnl: roundToTwoDecimals(netPnl),
      });

      position = null;
    }

    const markedEquity =
      position === null
        ? cashBalance
        : cashBalance + position.quantity * candle.close;

    if (markedEquity > peakEquity) {
      peakEquity = markedEquity;
    }

    const drawdown = peakEquity === 0 ? 0 : (peakEquity - markedEquity) / peakEquity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    if (equityCurve.length > 0) {
      const previousEquity = equityCurve[equityCurve.length - 1].equity;
      if (previousEquity > 0) {
        perPeriodReturns.push((markedEquity - previousEquity) / previousEquity);
      }
    }

    equityCurve.push({
      timestamp: candle.timestamp,
      equity: roundToTwoDecimals(markedEquity),
    });

    previousFast = fastValue;
    previousSlow = slowValue;
  }

  if (position) {
    const lastCandle: OHLCV = candles[candles.length - 1];
    const exitFill = applySlippage(lastCandle.close, slippageBps, "sell");
    const commission = commissionPerTrade;
    const proceeds = position.quantity * exitFill - commission;
    cashBalance += proceeds;

    const grossPnl = (exitFill - position.entryPrice) * position.quantity;
    const netPnl = grossPnl - (position.commissionPaid + commission);

    trades.push({
      entryTimestamp: position.entryTimestamp,
      entryPrice: roundToTwoDecimals(position.entryPrice),
      exitTimestamp: lastCandle.timestamp,
      exitPrice: roundToTwoDecimals(exitFill),
      quantity: position.quantity,
      grossPnl: roundToTwoDecimals(grossPnl),
      netPnl: roundToTwoDecimals(netPnl),
    });

    equityCurve[equityCurve.length - 1] = {
      timestamp: lastCandle.timestamp,
      equity: roundToTwoDecimals(cashBalance),
    };
  }

  const finalEquity = equityCurve.length
    ? equityCurve[equityCurve.length - 1].equity
    : initialCapital;

  const metrics = calculateMetrics({
    trades,
    equityCurve,
    initialCapital,
    maxDrawdown,
    perPeriodReturns,
    firstTimestamp: candles[0].timestamp,
    lastTimestamp: candles[candles.length - 1].timestamp,
  });

  return { trades, equityCurve, metrics };
}

/**
 * Applies symmetric slippage in basis points to the fill price. Positive
 * slippage increases the cost of buys and decreases the proceeds of sells.
 */
function applySlippage(
  price: number,
  slippageBps: number,
  side: "buy" | "sell"
): number {
  if (slippageBps <= 0) {
    return price;
  }

  const multiplier = slippageBps / BASIS_POINTS;
  return side === "buy" ? price * (1 + multiplier) : price * (1 - multiplier);
}

interface MetricComputationContext {
  readonly trades: BacktestTrade[];
  readonly equityCurve: EquityCurvePoint[];
  readonly initialCapital: number;
  readonly maxDrawdown: number;
  readonly perPeriodReturns: number[];
  readonly firstTimestamp: number;
  readonly lastTimestamp: number;
}

/**
 * Aggregates the trading records into the summary statistics presented in the
 * artefact. Each metric is documented inline for clarity and reproducibility.
 */
function calculateMetrics(context: MetricComputationContext): BacktestMetrics {
  const {
    trades,
    equityCurve,
    initialCapital,
    maxDrawdown,
    perPeriodReturns,
    firstTimestamp,
    lastTimestamp,
  } = context;

  const finalEquity = equityCurve.length
    ? equityCurve[equityCurve.length - 1].equity
    : initialCapital;
  const rawTotalReturn =
    initialCapital === 0 ? 0 : (finalEquity - initialCapital) / initialCapital;
  const totalReturn = roundToFourDecimals(normaliseTiny(rawTotalReturn));

  const durationSeconds = Math.max(lastTimestamp - firstTimestamp, 0);
  const years = durationSeconds / (365 * 24 * 60 * 60);
  const rawCagr =
    years <= 0
      ? rawTotalReturn
      : Math.pow(finalEquity / initialCapital, 1 / years) - 1;
  const cagr = roundToFourDecimals(normaliseTiny(rawCagr));

  let winningCount = 0;
  let losingCount = 0;
  let winningSum = 0;
  let losingSum = 0;

  for (const trade of trades) {
    if (trade.netPnl > 0) {
      winningCount += 1;
      winningSum += trade.netPnl;
    } else if (trade.netPnl < 0) {
      losingCount += 1;
      losingSum += Math.abs(trade.netPnl);
    }
  }

  const winRate = trades.length === 0 ? 0 : winningCount / trades.length;
  const averageWin = winningCount === 0 ? 0 : winningSum / winningCount;
  const averageLoss = losingCount === 0 ? 0 : losingSum / losingCount;

  const sharpe = computeSharpe(perPeriodReturns);

  const profitFactor =
    losingSum === 0
      ? winningSum === 0
        ? 0
        : winningSum
      : winningSum / losingSum;

  return {
    totalReturn,
    cagr,
    maxDrawdown: roundToFourDecimals(Math.max(0, normaliseTiny(maxDrawdown))),
    winRate: roundToFourDecimals(winRate),
    averageWin: roundToTwoDecimals(averageWin),
    averageLoss: roundToTwoDecimals(averageLoss),
    sharpe: roundToTwoDecimals(sharpe),
    profitFactor: roundToTwoDecimals(profitFactor),
    trades: trades.length,
  };
}

/** Computes a simple Sharpe ratio using per-period returns and 252 trading days. */
function computeSharpe(returns: number[]): number {
  if (returns.length === 0) {
    return 0;
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const stdDeviation = Math.sqrt(variance);

  if (stdDeviation === 0) {
    return 0;
  }

  // Annualise assuming ~252 trading periods per year (daily candles).
  return (Math.sqrt(252) * mean) / stdDeviation;
}

/** Rounds a number to two decimal places which matches broker statements. */
function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Rounds to four decimals which is useful for ratios (winRate, CAGR…). */
function roundToFourDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Normalises floating point artefacts so metrics do not expose values such as
 * `-0` or `1e-12`, which would be misleading in the rendered artefacts.
 */
function normaliseTiny(value: number): number {
  return Math.abs(value) <= 1e-10 ? 0 : value;
}
