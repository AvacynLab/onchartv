import { z } from "zod";

import type {
  CandleSeries,
  MarketDataAdapter,
  OHLCV,
  Quote,
} from "./types";

/**
 * In-memory implementation of the market data adapter used by unit tests and
 * Playwright scenarios. The adapter stores deterministic series so the CI build
 * never depends on external APIs or live data.
 */
export class InMemoryMarketDataAdapter implements MarketDataAdapter {
  private readonly historyStore: Map<string, OHLCV[]>;

  constructor(seed: Record<string, CandleSeries>) {
    this.historyStore = new Map(
      Object.entries(seed).map(([symbol, candles]) => [symbol, [...candles]])
    );
  }

  async history(params: {
    readonly symbol: string;
    readonly timeframe: string;
    readonly from: number;
    readonly to: number;
    readonly limit?: number;
  }): Promise<OHLCV[]> {
    const series = this.requireSeries(params.symbol);
    const filtered = series.filter(
      (candle) => candle.timestamp >= params.from && candle.timestamp <= params.to
    );
    const limited =
      params.limit && params.limit > 0 ? filtered.slice(-params.limit) : filtered;
    return limited.map((candle) => ({ ...candle }));
  }

  async quote(params: { readonly symbol: string }): Promise<Quote> {
    const series = this.requireSeries(params.symbol);
    const last = series[series.length - 1];
    return {
      symbol: params.symbol,
      price: last.close,
      timestamp: last.timestamp,
    };
  }

  private requireSeries(symbol: string): OHLCV[] {
    const series = this.historyStore.get(symbol);
    if (!series) {
      throw new Error(`Unknown symbol '${symbol}' in in-memory adapter.`);
    }
    return series;
  }
}

/**
 * Zod schema describing the candle payload returned by external market data
 * providers. Using coercion ensures the adapter accepts numeric strings while
 * downstream consumers always interact with typed numbers.
 */
const candleSchema = z.object({
  timestamp: z.coerce.number(),
  open: z.coerce.number(),
  high: z.coerce.number(),
  low: z.coerce.number(),
  close: z.coerce.number(),
  volume: z.coerce.number(),
});

const historyResponseSchema = z.object({
  candles: z.array(candleSchema),
});

const quoteResponseSchema = z.object({
  symbol: z.string(),
  price: z.coerce.number(),
  timestamp: z.coerce.number(),
});

const DEFAULT_TIMEOUT_MS = 10_000;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * HTTP implementation of the market data adapter. The adapter targets
 * third-party providers when `FEATURE_USE_REAL_DATA` is enabled, applying a
 * defensive timeout and strict schema validation so unexpected payloads do not
 * leak into the rest of the finance pipeline.
 */
export class HttpMarketDataAdapter implements MarketDataAdapter {
  private readonly fetchImpl: FetchImplementation;

  private readonly timeoutMs: number;

  private readonly baseUrl: string;

  private readonly apiKey: string;

  constructor(options: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly timeoutMs?: number;
    readonly fetch?: FetchImplementation;
  }) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async history(params: {
    readonly symbol: string;
    readonly timeframe: string;
    readonly from: number;
    readonly to: number;
    readonly limit?: number;
  }): Promise<OHLCV[]> {
    const response = await this.request("history", {
      symbol: params.symbol,
      timeframe: params.timeframe,
      from: Math.floor(params.from).toString(),
      to: Math.floor(params.to).toString(),
      ...(params.limit ? { limit: params.limit.toString() } : {}),
    });

    const parsed = historyResponseSchema.safeParse(response);

    if (!parsed.success) {
      throw new Error(
        `Invalid response from market data provider for history: ${parsed.error.message}`
      );
    }

    return parsed.data.candles.map((candle) => ({
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }));
  }

  async quote(params: { readonly symbol: string }): Promise<Quote> {
    const response = await this.request("quote", { symbol: params.symbol });
    const parsed = quoteResponseSchema.safeParse(response);

    if (!parsed.success) {
      throw new Error(
        `Invalid response from market data provider for quote: ${parsed.error.message}`
      );
    }

    return parsed.data;
  }

  private async request(
    path: string,
    searchParams: Record<string, string>
  ): Promise<unknown> {
    const url = this.buildUrl(path, searchParams);
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await safeReadError(response);
        throw new Error(
          `Market data request to '${path}' failed with ${response.status}: ${detail}`
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Market data request to '${path}' timed out after ${this.timeoutMs}ms.`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUrl(path: string, params: Record<string, string>): string {
    const normalizedBase = this.baseUrl.endsWith("/")
      ? this.baseUrl
      : `${this.baseUrl}/`;
    const url = new URL(path, normalizedBase);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    if (this.apiKey) {
      url.searchParams.set("apiKey", this.apiKey);
    }

    return url.toString();
  }
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data === "object" && data !== null) {
      const message =
        "message" in data && typeof data.message === "string"
          ? data.message
          : JSON.stringify(data);
      return message;
    }
    return String(data);
  } catch (error) {
    const text = await response.text().catch(() => "<no body>");
    if (text) {
      return text;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "unknown error";
  }
}

/**
 * Generates a deterministic mock price series using a sine wave with additive
 * trend. The helper is intentionally simple yet produces realistic looking
 * candles with higher highs/lows.
 */
export function generateMockSeries(options: {
  readonly startTimestamp: number;
  readonly candles: number;
  readonly basePrice?: number;
  readonly amplitude?: number;
  readonly trendPerCandle?: number;
}): CandleSeries {
  const {
    candles,
    startTimestamp,
    basePrice = 100,
    amplitude = 2,
    trendPerCandle = 0.1,
  } = options;

  const result: OHLCV[] = [];
  const period = 20;

  for (let index = 0; index < candles; index += 1) {
    const timestamp = startTimestamp + index * 86_400; // assume daily candles
    const sine = Math.sin((2 * Math.PI * index) / period);
    const price = basePrice + amplitude * sine + trendPerCandle * index;
    const open = price + randomJitter(index, amplitude * 0.1);
    const close = price + randomJitter(index + 1, amplitude * 0.1);
    const high = Math.max(open, close) + Math.abs(randomJitter(index + 2, amplitude * 0.2));
    const low = Math.min(open, close) - Math.abs(randomJitter(index + 3, amplitude * 0.2));
    const volume = 1_000 + (Math.abs(sine) * 500 + index * 5);

    result.push({
      timestamp,
      open: roundToTwoDecimals(open),
      high: roundToTwoDecimals(high),
      low: roundToTwoDecimals(Math.max(low, 0.01)),
      close: roundToTwoDecimals(close),
      volume: Math.round(volume),
    });
  }

  return result;
}

function randomJitter(seed: number, magnitude: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  const fractional = value - Math.floor(value);
  return (fractional - 0.5) * 2 * magnitude;
}

function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
