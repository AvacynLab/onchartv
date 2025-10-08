import { generateMockSeries } from "./data-adapter";
import type {
  CandleSeries,
  FinanceSymbol,
  FundamentalSnapshot,
  MockNewsItem,
} from "./types";

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


/**
 * Deterministic OHLCV series keyed by symbol. The mock generator produces daily
 * candles with a mild up-trend so technical indicators and the backtest engine
 * have realistic data to chew on while keeping the runtime fully hermetic.
 */
/**
 * Daily candles need to cover both the historical backtests exercised by the
 * Playwright suite (2018 → 2020) and the more recent chart requests showcased in
 * the UI (2024 → 2025). Starting the synthetic catalogue on 2018‑01‑01 and
 * generating roughly eight years of data guarantees both windows are available
 * without introducing flaky, time-dependent behaviour.
 */
const SERIES_START_TIMESTAMP = Date.UTC(2018, 0, 1) / 1000;

/**
 * Eight years of daily candles (~2 920 entries) rounded up to 3 000 to leave a
 * small buffer for extended test ranges.
 */
const SERIES_CANDLE_COUNT = 3_000;

export const FINANCE_SERIES: Record<FinanceSymbol, CandleSeries> = {
  AAPL: generateMockSeries({
    startTimestamp: SERIES_START_TIMESTAMP,
    candles: SERIES_CANDLE_COUNT,
    basePrice: 170,
    /**
     * L'amplitude accrue et la pente très douce garantissent plusieurs
     * croisements des moyennes mobiles 50/200 sur la fenêtre 2018-2020.
     * Les suites d'accessibilité Playwright vérifient que le bouton
     * « Suivant » du journal des trades reste focusable; sans au moins deux
     * pages de résultats, le bouton est désactivé et l'assertion échoue.
     */
    amplitude: 20,
    trendPerCandle: 0.02,
  }),
  NVDA: generateMockSeries({
    startTimestamp: SERIES_START_TIMESTAMP,
    candles: SERIES_CANDLE_COUNT,
    basePrice: 450,
    amplitude: 6,
    trendPerCandle: 0.3,
  }),
  BTCUSD: generateMockSeries({
    startTimestamp: SERIES_START_TIMESTAMP,
    candles: SERIES_CANDLE_COUNT,
    basePrice: 30_000,
    amplitude: 1_200,
    trendPerCandle: 25,
  }),
  ETHUSD: generateMockSeries({
    startTimestamp: SERIES_START_TIMESTAMP,
    candles: SERIES_CANDLE_COUNT,
    basePrice: 1_800,
    amplitude: 90,
    trendPerCandle: 1.5,
  }),
  EURUSD: generateMockSeries({
    startTimestamp: SERIES_START_TIMESTAMP,
    candles: SERIES_CANDLE_COUNT,
    basePrice: 1.08,
    amplitude: 0.01,
    trendPerCandle: 0.0001,
  }),
};

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
    /**
     * Additional NVDA entries keep the offline mocks aligned with the E2E
     * journey that requests "3 news" items. Their timestamps intentionally span
     * multiple weeks so the chronological sorting exercised by the tests can
     * detect regressions.
     */
    id: "news-nvda-2",
    symbol: "NVDA",
    source: "MockWire",
    title: "La division gaming de NVIDIA franchit un nouveau palier",
    url: "https://news.example.com/nvda-gaming",
    summary:
      "Les revenus gaming progressent de 18 % grâce aux cartes spécialisées IA et au ray tracing génératif.",
    publishedAt: "2025-02-10T14:05:00Z",
    sentiment: "neutral",
  },
  {
    id: "news-nvda-3",
    symbol: "NVDA",
    source: "Les Échos",
    title: "NVIDIA investit dans une chaîne d'approvisionnement européenne",
    url: "https://news.example.com/nvda-europe",
    summary:
      "Un plan d'investissement conjoint avec plusieurs fondeurs vise à sécuriser la production de puces haut de gamme.",
    publishedAt: "2025-02-24T07:45:00Z",
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

export type { FinanceSymbol, FundamentalSnapshot, MockNewsItem } from "./types";
