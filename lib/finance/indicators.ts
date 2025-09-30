import {
  type BollingerBandsOptions,
  type BollingerBandsPoint,
  type CandleSeries,
  type NullableNumericSeries,
  type PriceSeries,
  type SeriesComputationOptions,
} from "./types";

/** Utility to guard against invalid window sizes. */
function assertValidPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error(
      `Indicator period must be a positive integer. Received: ${period}`
    );
  }
}

/** Validates incoming price data to avoid propagating NaNs through metrics. */
function assertFinite(value: number, index: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(
      `Indicator series expects finite numeric values. Received ${value} at index ${index}`
    );
  }
}

/**
 * Computes a simple moving average (SMA) over the provided price series.
 *
 * The implementation uses a rolling sum so each new point is O(1). Values are
 * reported as `null` until the rolling window is fully populated, ensuring the
 * returned array stays aligned with the source series.
 */
export function calculateSMA(
  series: PriceSeries,
  options: SeriesComputationOptions
): NullableNumericSeries {
  const { period } = options;
  assertValidPeriod(period);

  const result: NullableNumericSeries = new Array(series.length).fill(null);
  let rollingSum = 0;

  for (let index = 0; index < series.length; index += 1) {
    const value = series[index];
    assertFinite(value, index);
    rollingSum += value;

    if (index >= period) {
      rollingSum -= series[index - period];
    }

    if (index >= period - 1) {
      result[index] = rollingSum / period;
    }
  }

  return result;
}

/**
 * Computes an exponential moving average (EMA) using the standard smoothing
 * factor `2 / (period + 1)`. The first defined value aligns with the SMA of the
 * first window so the series matches popular trading platforms.
 */
export function calculateEMA(
  series: PriceSeries,
  options: SeriesComputationOptions
): NullableNumericSeries {
  const { period } = options;
  assertValidPeriod(period);

  const smaSeries = calculateSMA(series, options);
  const result: NullableNumericSeries = new Array(series.length).fill(null);
  const smoothing = 2 / (period + 1);
  let previousEma: number | null = null;

  for (let index = 0; index < series.length; index += 1) {
    const price = series[index];
    assertFinite(price, index);

    if (smaSeries[index] === null) {
      continue;
    }

    if (previousEma === null) {
      previousEma = smaSeries[index] as number;
      result[index] = previousEma;
      continue;
    }

    const prev = previousEma as number;
    /**
     * Reusing the prior EMA value lets us update the series without recalculating
     * the entire window, matching the canonical exponential smoothing formula.
     */
    const emaValue = (price - prev) * smoothing + prev;
    previousEma = emaValue;
    result[index] = emaValue;
  }

  return result;
}

/**
 * Calculates the Relative Strength Index (RSI) using Wilder's smoothing.
 *
 * RSI describes the velocity of price changes between 0 and 100. A period of 14
 * is common, but the helper accepts any positive integer. The first defined RSI
 * value appears at index `period` because we need one change per candle.
 */
export function calculateRSI(
  series: PriceSeries,
  options: SeriesComputationOptions
): NullableNumericSeries {
  const { period } = options;
  assertValidPeriod(period);

  if (series.length === 0) {
    return [];
  }

  const result: NullableNumericSeries = new Array(series.length).fill(null);

  if (series.length <= period) {
    return result;
  }

  let gainSum = 0;
  let lossSum = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = series[index] - series[index - 1];
    assertFinite(change, index);

    if (change > 0) {
      gainSum += change;
    } else {
      lossSum += Math.abs(change);
    }
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;

  const firstRSI = resolveRSI(averageGain, averageLoss);
  result[period] = firstRSI;

  for (let index = period + 1; index < series.length; index += 1) {
    const change = series[index] - series[index - 1];
    assertFinite(change, index);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    averageGain = ((averageGain * (period - 1)) + gain) / period;
    averageLoss = ((averageLoss * (period - 1)) + loss) / period;

    result[index] = resolveRSI(averageGain, averageLoss);
  }

  return result;
}

/**
 * Builds Bollinger Bands (middle/upper/lower) using the candle close prices.
 *
 * The implementation keeps the timestamp of the source candle so the artefact
 * renderer can overlay the bands in lightweight-charts without reindexing.
 */
export function calculateBollingerBands(
  candles: CandleSeries,
  options: BollingerBandsOptions
): BollingerBandsPoint[] {
  const { period, standardDeviations = 2 } = options;
  assertValidPeriod(period);

  if (!Number.isFinite(standardDeviations) || standardDeviations <= 0) {
    throw new Error(
      `Standard deviation multiplier must be positive. Received: ${standardDeviations}`
    );
  }

  const closes = candles.map((candle, index) => {
    assertFinite(candle.close, index);
    return candle.close;
  });

  const smaSeries = calculateSMA(closes, { period });
  const points: BollingerBandsPoint[] = candles.map((candle, index) => ({
    timestamp: candle.timestamp,
    middle: null,
    upper: null,
    lower: null,
  }));

  for (let index = 0; index < candles.length; index += 1) {
    const mean = smaSeries[index];
    if (mean === null) {
      continue;
    }

    let sumSquares = 0;
    for (let offset = 0; offset < period; offset += 1) {
      const sampleIndex = index - offset;
      const price = closes[sampleIndex];
      const deviation = price - mean;
      sumSquares += deviation * deviation;
    }

    const variance = sumSquares / period;
    const stdDeviation = Math.sqrt(variance);

    points[index] = {
      timestamp: candles[index].timestamp,
      middle: mean,
      upper: mean + stdDeviation * standardDeviations,
      lower: mean - stdDeviation * standardDeviations,
    };
  }

  return points;
}

/** Converts average gains/losses into an RSI value between 0 and 100. */
function resolveRSI(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }

  if (averageGain === 0) {
    return 0;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}
