import { createRequire } from "module";

/**
 * Next's `server-only` helper ensures catalogue consumers are never bundled
 * into Client Components. The module throws if it is evaluated in plain Node
 * (for example when the seed script runs via `tsx`), so we only attempt to
 * require it when the helper is available and silently ignore failures in
 * non-Next runtimes.
 */
if (typeof window === "undefined") {
  const require = createRequire(import.meta.url);

  try {
    require("server-only");
  } catch {
    // Running outside of Next.js (seed scripts, Vitest in Node) where the
    // `server-only` shim is intentionally unavailable. In those environments
    // the catalogue is still server-side, so we can safely proceed.
  }
}

import type { FinanceSymbol } from "./mock-data";
import type { Asset } from "@/lib/db/schema";

/**
 * Canonical catalogue describing each offline asset supported by the finance
 * artefacts. The structure mirrors the entries inserted by the seed script so
 * HTTP handlers, AI tools, and the database remain in sync when reasoning about
 * symbols. Keeping the metadata centralised prevents subtle mismatches between
 * the mock market data and the persisted asset records.
 */
export interface FinanceAssetMetadata {
  /** Uppercase ticker / pair identifier used across the UI and APIs. */
  readonly symbol: FinanceSymbol;
  /** Primary exchange or venue that best represents the mock data source. */
  readonly exchange: string;
  /** Asset class used by the relational schema. */
  readonly type: Asset["type"];
  /** Human readable label displayed in dropdowns and artefacts. */
  readonly name: string;
  /** Quoted currency for PnL calculations and chart axes. */
  readonly currency: string;
}

/**
 * Exhaustive metadata map keyed by symbol. The entries are intentionally small
 * so they can be serialised inside artefacts when we need to explain a
 * backtest's configuration or annotate a chart with venue information.
 */
export const FINANCE_ASSET_CATALOG: Record<FinanceSymbol, FinanceAssetMetadata> = {
  AAPL: {
    symbol: "AAPL",
    exchange: "NASDAQ",
    type: "equity",
    name: "Apple Inc.",
    currency: "USD",
  },
  NVDA: {
    symbol: "NVDA",
    exchange: "NASDAQ",
    type: "equity",
    name: "NVIDIA Corporation",
    currency: "USD",
  },
  BTCUSD: {
    symbol: "BTCUSD",
    exchange: "COINBASE",
    type: "crypto",
    name: "Bitcoin / US Dollar",
    currency: "USD",
  },
  ETHUSD: {
    symbol: "ETHUSD",
    exchange: "COINBASE",
    type: "crypto",
    name: "Ethereum / US Dollar",
    currency: "USD",
  },
  EURUSD: {
    symbol: "EURUSD",
    exchange: "OANDA",
    type: "fx",
    name: "Euro / US Dollar",
    currency: "USD",
  },
};

/**
 * Normalises arbitrary user input ("btcUsd"/" btcusd ") and returns the
 * corresponding catalogue entry. Returning `null` instead of throwing keeps the
 * request handlers in control of the HTTP surface they want to expose.
 */
export function findAssetMetadata(
  symbol: string
): FinanceAssetMetadata | null {
  const normalised = symbol.trim().toUpperCase() as FinanceSymbol;
  return FINANCE_ASSET_CATALOG[normalised] ?? null;
}

/**
 * Returns a list of supported symbols. The helper comes in handy when we need
 * to advertise capabilities in documentation or prompt guardrails.
 */
export function listSupportedSymbols(): FinanceSymbol[] {
  return Object.keys(FINANCE_ASSET_CATALOG) as FinanceSymbol[];
}
