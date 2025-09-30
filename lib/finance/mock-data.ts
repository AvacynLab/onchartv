import { generateMockSeries } from "./data-adapter";
import type { CandleSeries } from "./types";

/**
 * Canonical catalogue of symbols supported by the offline finance tools. The
 * list intentionally mirrors the seed data inserted in the Postgres fixtures so
 * unit tests, Playwright, and local development all operate on the same set of
 * assets.
 */
export const FINANCE_SYMBOLS = [
  "AAPL",
  "NVDA",
  "BTCUSD",
  "ETHUSD",
  "EURUSD",
] as const;

export type FinanceSymbol = (typeof FINANCE_SYMBOLS)[number];

/**
 * Deterministic OHLCV series keyed by symbol. The mock generator produces daily
 * candles with a mild up-trend so technical indicators and the backtest engine
 * have realistic data to chew on while keeping the runtime fully hermetic.
 */
export const FINANCE_SERIES: Record<FinanceSymbol, CandleSeries> = {
  AAPL: generateMockSeries({
    startTimestamp: 1_700_000_000,
    candles: 720,
    basePrice: 170,
    amplitude: 3,
    trendPerCandle: 0.12,
  }),
  NVDA: generateMockSeries({
    startTimestamp: 1_700_000_000,
    candles: 720,
    basePrice: 450,
    amplitude: 6,
    trendPerCandle: 0.3,
  }),
  BTCUSD: generateMockSeries({
    startTimestamp: 1_700_000_000,
    candles: 720,
    basePrice: 30_000,
    amplitude: 1_200,
    trendPerCandle: 25,
  }),
  ETHUSD: generateMockSeries({
    startTimestamp: 1_700_000_000,
    candles: 720,
    basePrice: 1_800,
    amplitude: 90,
    trendPerCandle: 1.5,
  }),
  EURUSD: generateMockSeries({
    startTimestamp: 1_700_000_000,
    candles: 720,
    basePrice: 1.08,
    amplitude: 0.01,
    trendPerCandle: 0.0001,
  }),
};

export interface FundamentalSnapshot {
  readonly symbol: FinanceSymbol;
  readonly marketCap: number;
  readonly peRatio: number;
  readonly dividendYield: number;
  readonly revenueTtm: number;
  readonly grossMargin: number;
  readonly netMargin: number;
  readonly debtToEquity: number;
}

/**
 * Lightweight fundamental metrics derived from public filings. Values are
 * rounded and static – the goal is to give the agent enough material to explain
 * trends without leaking production secrets or requiring network calls.
 */
export const FUNDAMENTAL_SNAPSHOTS: Record<FinanceSymbol, FundamentalSnapshot> = {
  AAPL: {
    symbol: "AAPL",
    marketCap: 2.8e12,
    peRatio: 27.4,
    dividendYield: 0.005,
    revenueTtm: 3.83e11,
    grossMargin: 0.44,
    netMargin: 0.26,
    debtToEquity: 1.6,
  },
  NVDA: {
    symbol: "NVDA",
    marketCap: 2.2e12,
    peRatio: 35.1,
    dividendYield: 0.0004,
    revenueTtm: 8.9e10,
    grossMargin: 0.74,
    netMargin: 0.55,
    debtToEquity: 0.4,
  },
  BTCUSD: {
    symbol: "BTCUSD",
    marketCap: 5.9e11,
    peRatio: 0,
    dividendYield: 0,
    revenueTtm: 0,
    grossMargin: 0,
    netMargin: 0,
    debtToEquity: 0,
  },
  ETHUSD: {
    symbol: "ETHUSD",
    marketCap: 2.3e11,
    peRatio: 0,
    dividendYield: 0,
    revenueTtm: 0,
    grossMargin: 0,
    netMargin: 0,
    debtToEquity: 0,
  },
  EURUSD: {
    symbol: "EURUSD",
    marketCap: 0,
    peRatio: 0,
    dividendYield: 0,
    revenueTtm: 0,
    grossMargin: 0,
    netMargin: 0,
    debtToEquity: 0.12,
  },
};

export interface MockNewsItem {
  readonly id: string;
  readonly symbol: FinanceSymbol;
  readonly source: string;
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly publishedAt: string;
  readonly sentiment: "positive" | "neutral" | "negative";
}

/**
 * Curated news headlines summarised for offline consumption. Timestamps are ISO
 * strings to avoid timezone ambiguity when rendered in artefacts or Playwright
 * expectations.
 */
export const NEWS_ITEMS: readonly MockNewsItem[] = [
  {
    id: "news-aapl-1",
    symbol: "AAPL",
    source: "Bloomberg",
    title: "Apple dévoile un rafraîchissement de l'iPhone axé IA",
    url: "https://news.example.com/aapl-iphone-ai",
    summary:
      "La keynote annuelle met l'accent sur l'inférence locale et des fonctionnalités génératives dédiées au productivité.",
    publishedAt: "2025-02-12T15:30:00Z",
    sentiment: "positive",
  },
  {
    id: "news-aapl-2",
    symbol: "AAPL",
    source: "WSJ",
    title: "Les ventes de services compensent un cycle matériel plus mou",
    url: "https://news.example.com/aapl-services",
    summary:
      "Les revenus issus de l'App Store et d'iCloud progressent de 12 % sur un an, soutenant les marges.",
    publishedAt: "2025-03-05T12:00:00Z",
    sentiment: "neutral",
  },
  {
    id: "news-nvda-1",
    symbol: "NVDA",
    source: "Reuters",
    title: "NVIDIA étend sa feuille de route data center",
    url: "https://news.example.com/nvda-datacenter",
    summary:
      "Le groupe annonce une nouvelle gamme de GPU axés sur l'inférence temps réel et des partenariats cloud renforcés.",
    publishedAt: "2025-01-22T09:15:00Z",
    sentiment: "positive",
  },
  {
    id: "news-btc-1",
    symbol: "BTCUSD",
    source: "CoinDesk",
    title: "Les flux ETF bitcoin atteignent un nouveau pic",
    url: "https://news.example.com/btc-etf",
    summary:
      "Les entrées nettes dépassent 500 M$ sur la semaine, signalant un regain d'intérêt institutionnel.",
    publishedAt: "2025-02-28T18:45:00Z",
    sentiment: "positive",
  },
  {
    id: "news-eth-1",
    symbol: "ETHUSD",
    source: "The Block",
    title: "La roadmap scaling se précise pour Ethereum",
    url: "https://news.example.com/eth-scaling",
    summary:
      "Les développeurs confirment l'activation d'un lot de propositions visant à réduire drastiquement les frais de gas.",
    publishedAt: "2025-02-05T21:10:00Z",
    sentiment: "positive",
  },
  {
    id: "news-eurusd-1",
    symbol: "EURUSD",
    source: "Financial Times",
    title: "La BCE temporise face au ralentissement européen",
    url: "https://news.example.com/eurusd-bce",
    summary:
      "Christine Lagarde évoque une pause prolongée avant d'ajuster les taux directeurs, citant une inflation sous contrôle.",
    publishedAt: "2025-03-01T07:55:00Z",
    sentiment: "neutral",
  },
];
