import type {
  CandleSeries,
  PatternDetection,
  SupportResistanceLevel,
} from "./types";

/**
 * Detects a set of simple candlestick patterns and returns their positions.
 *
 * The heuristics intentionally remain conservative so artefacts only highlight
 * the most obvious structures which are easier to explain to the user.
 */
export function detectCandlestickPatterns(
  candles: CandleSeries
): PatternDetection[] {
  const detections: PatternDetection[] = [];

  const trendWindow = 3;

  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];

    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    if (range === 0) {
      continue;
    }

    const upperShadow = current.high - Math.max(current.open, current.close);
    const lowerShadow = Math.min(current.open, current.close) - current.low;

    const isHammer =
      body / range <= 0.3 &&
      lowerShadow / range >= 0.5 &&
      upperShadow / range <= 0.2 &&
      current.close > current.open &&
      hasDowntrend(candles, index, trendWindow);

    if (isHammer) {
      detections.push({
        index,
        timestamp: current.timestamp,
        pattern: {
          name: "hammer",
          explanation:
            "Bullish hammer detected — long lower shadow after a decline often signals potential reversal.",
        },
      });
    }

    const previousBody = Math.abs(previous.close - previous.open);
    const isBullishEngulfing =
      previous.close < previous.open &&
      current.close > current.open &&
      current.open <= previous.close &&
      current.close >= previous.open &&
      body >= previousBody &&
      hasDowntrend(candles, index, trendWindow);

    if (isBullishEngulfing) {
      detections.push({
        index,
        timestamp: current.timestamp,
        pattern: {
          name: "bullish_engulfing",
          explanation:
            "Bullish engulfing pattern — buyers overwhelmed prior selling pressure.",
        },
      });
    }

    const isBearishEngulfing =
      previous.close > previous.open &&
      current.close < current.open &&
      current.open >= previous.close &&
      current.close <= previous.open &&
      body >= previousBody &&
      hasUptrend(candles, index, trendWindow);

    if (isBearishEngulfing) {
      detections.push({
        index,
        timestamp: current.timestamp,
        pattern: {
          name: "bearish_engulfing",
          explanation:
            "Bearish engulfing pattern — renewed selling pressure after a short-term advance.",
        },
      });
    }
  }

  return detections;
}

interface SupportResistanceOptions {
  /** Number of candles to inspect on each side when confirming a pivot. */
  readonly lookback?: number;
  /** Permitted tolerance between highs/lows when grouping levels. */
  readonly tolerance?: number;
}

/**
 * Identifies basic support and resistance zones using swing highs/lows. The
 * algorithm scans for local extrema and groups nearby pivots into a single
 * level to avoid duplicate annotations in the artefact renderer.
 */
export function detectSupportResistanceLevels(
  candles: CandleSeries,
  options: SupportResistanceOptions = {}
): SupportResistanceLevel[] {
  const lookback = options.lookback ?? 2;
  const tolerance = options.tolerance ?? 0.0025; // 0.25 % of price

  if (candles.length < lookback * 2 + 1) {
    return [];
  }

  const levels: SupportResistanceLevel[] = [];

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    const candle = candles[index];
    const isSupport = isLocalMinimum(candles, index, lookback);
    const isResistance = isLocalMaximum(candles, index, lookback);

    if (isSupport) {
      mergeLevel(levels, {
        type: "support",
        price: candle.low,
        fromTimestamp: candles[index - lookback].timestamp,
        toTimestamp: candles[index + lookback].timestamp,
      }, tolerance);
    }

    if (isResistance) {
      mergeLevel(levels, {
        type: "resistance",
        price: candle.high,
        fromTimestamp: candles[index - lookback].timestamp,
        toTimestamp: candles[index + lookback].timestamp,
      }, tolerance);
    }
  }

  return levels;
}

function isLocalMinimum(
  candles: CandleSeries,
  index: number,
  lookback: number
): boolean {
  const pivotLow = candles[index].low;
  for (let offset = 1; offset <= lookback; offset += 1) {
    if (candles[index - offset].low <= pivotLow) {
      return false;
    }
    if (candles[index + offset].low <= pivotLow) {
      return false;
    }
  }
  return true;
}

function isLocalMaximum(
  candles: CandleSeries,
  index: number,
  lookback: number
): boolean {
  const pivotHigh = candles[index].high;
  for (let offset = 1; offset <= lookback; offset += 1) {
    if (candles[index - offset].high >= pivotHigh) {
      return false;
    }
    if (candles[index + offset].high >= pivotHigh) {
      return false;
    }
  }
  return true;
}

/**
 * Groups a support or resistance level with an existing entry when the prices
 * are sufficiently close. This keeps the artefact output concise by avoiding
 * duplicate annotations that would otherwise overlap visually.
 */
function mergeLevel(
  levels: SupportResistanceLevel[],
  candidate: SupportResistanceLevel,
  tolerance: number
) {
  const existingIndex = levels.findIndex(
    (level) =>
      level.type === candidate.type &&
      Math.abs(level.price - candidate.price) / candidate.price <= tolerance
  );

  if (existingIndex >= 0) {
    const existing = levels[existingIndex];
    const merged: SupportResistanceLevel = {
      type: existing.type,
      // Average the price of the grouped levels so the displayed line matches
      // the midpoint of the zone instead of favouring the newest candidate.
      price: (existing.price + candidate.price) / 2,
      fromTimestamp: Math.min(existing.fromTimestamp, candidate.fromTimestamp),
      toTimestamp: Math.max(existing.toTimestamp, candidate.toTimestamp),
    };
    levels[existingIndex] = merged;
    return;
  }

  levels.push({ ...candidate });
}

/**
 * Confirms that the candles leading into the potential reversal formed a
 * persistent downtrend. The helper combines a simple slope check with a vote on
 * individual candle moves so noisy oscillations do not trigger patterns.
 */
function hasDowntrend(
  candles: CandleSeries,
  pivotIndex: number,
  window: number
): boolean {
  if (pivotIndex < 1) {
    return false;
  }

  const startIndex = Math.max(0, pivotIndex - window);
  if (pivotIndex - startIndex < 1) {
    return false;
  }

  const startClose = candles[startIndex].close;
  const endClose = candles[pivotIndex - 1].close;

  if (!Number.isFinite(startClose) || startClose === 0) {
    return false;
  }

  const change = (endClose - startClose) / Math.abs(startClose);
  if (change >= -0.003) {
    return false;
  }

  let decreases = 0;
  let increases = 0;
  for (let index = startIndex + 1; index <= pivotIndex - 1; index += 1) {
    const current = candles[index].close;
    const previous = candles[index - 1].close;
    if (current < previous) {
      decreases += 1;
    } else if (current > previous) {
      increases += 1;
    }
  }

  return decreases > 0 && decreases >= increases;
}

/**
 * Symmetric helper validating that a sequence of rising closes preceded the
 * candidate reversal candle.
 */
function hasUptrend(
  candles: CandleSeries,
  pivotIndex: number,
  window: number
): boolean {
  if (pivotIndex < 1) {
    return false;
  }

  const startIndex = Math.max(0, pivotIndex - window);
  if (pivotIndex - startIndex < 1) {
    return false;
  }

  const startClose = candles[startIndex].close;
  const endClose = candles[pivotIndex - 1].close;

  if (!Number.isFinite(startClose) || startClose === 0) {
    return false;
  }

  const change = (endClose - startClose) / Math.abs(startClose);
  if (change <= 0.003) {
    return false;
  }

  let increases = 0;
  let decreases = 0;
  for (let index = startIndex + 1; index <= pivotIndex - 1; index += 1) {
    const current = candles[index].close;
    const previous = candles[index - 1].close;
    if (current > previous) {
      increases += 1;
    } else if (current < previous) {
      decreases += 1;
    }
  }

  return increases > 0 && increases >= decreases;
}
