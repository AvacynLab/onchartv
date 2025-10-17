import "server-only";

import { logWarning } from "@/lib/logging";

import { HttpMarketDataAdapter, InMemoryMarketDataAdapter } from "./data-adapter";
import { FINANCE_SERIES } from "./mock-data";
import type { MarketDataAdapter } from "./types";

/**
 * Singleton instance of the market data adapter used by API routes. The
 * helper inspects environment variables so deployments can opt into a real HTTP
 * provider while defaulting to the deterministic in-memory dataset for local
 * development, unit tests, and Playwright runs.
 */
const adapter: MarketDataAdapter = createAdapter();

/**
 * Returns the shared adapter. The function wrapper exists to make future
 * dependency injection easier (for example wiring a real provider when feature
 * flags are enabled) without touching the call-sites in the route handlers.
 */
export function getMarketDataAdapter(): MarketDataAdapter {
  return adapter;
}

function createAdapter(): MarketDataAdapter {
  const useRealData =
    String(process.env.FEATURE_USE_REAL_DATA).toLowerCase() === "true";

  if (!useRealData) {
    return new InMemoryMarketDataAdapter(FINANCE_SERIES);
  }

  const baseUrl = process.env.MARKET_DATA_API_BASE_URL;
  const apiKey = process.env.MARKET_DATA_API_KEY;

  if (!baseUrl || !apiKey) {
    // Provide feature-flag diagnostics without leaking the raw credentials to stdout.
    logWarning(
      "finance:server-adapter",
      "FEATURE_USE_REAL_DATA enabled but market data credentials are missing. Falling back to deterministic mocks.",
      {
        hasBaseUrl: Boolean(baseUrl),
        credentialsConfigured: Boolean(apiKey),
      }
    );
    return new InMemoryMarketDataAdapter(FINANCE_SERIES);
  }

  return new HttpMarketDataAdapter({ baseUrl, apiKey });
}
