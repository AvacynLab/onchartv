import type { Page } from "@playwright/test";
import { z } from "zod";

import {
  FINANCE_SERIES,
  FUNDAMENTAL_SNAPSHOTS,
  NEWS_ITEMS,
  type FinanceSymbol,
} from "../../lib/finance/mock-data";
import { runBacktest } from "../../lib/finance/backtest/engine";
import {
  DEFAULT_FINANCE_PREFERENCES,
  financePreferencesSchema,
  type FinancePreferences,
} from "../../lib/finance/preferences";
import type { BacktestParameters } from "../../lib/finance/types";

/**
 * Deterministic timestamp used to freeze the Playwright clock. Keeping the
 * value exported allows other suites to share the exact reference when they
 * assert on mocked payloads (for example rate-limit resets).
 */
export const FIXED_NOW_ISO = "2025-03-01T12:00:00Z";

/** Mock rate-limit metadata shared by every intercepted finance endpoint. */
export const MOCK_RATE_LIMIT = {
  allowed: true,
  remaining: 42,
  reset: Date.parse(FIXED_NOW_ISO) + 60_000,
  resetInMs: 0,
} as const;

export type FinanceInterceptLog = {
  preferencesGet: number;
  preferencesPatch: number;
  history: number;
  fundamentals: number;
  news: number;
  backtest: number;
  quote: number;
  screen: number;
};

export type FinanceMocksHandle = FinanceInterceptLog & {
  /**
   * Read the current finance preferences snapshot stored by the mocks. Tests
   * use this to assert that UI interactions persisted the intended changes.
   */
  getPreferences: () => FinancePreferences;
  /**
   * Persist a new preference state via the underlying API to keep the dev
   * server and Playwright context aligned. The helper mirrors the behaviour of
   * the finance settings drawer while remaining entirely offline.
   */
  setPreferences: (preferences: FinancePreferences) => Promise<void>;
};

/** Zod schema mirroring the finance screen API contract. */
const screenRequestSchema = z
  .object({
    filters: z
      .object({
        minMarketCap: z
          .number()
          .min(0, "filters.minMarketCap must be zero or greater")
          .optional(),
        maxPeRatio: z
          .number()
          .min(0, "filters.maxPeRatio must be zero or greater")
          .optional(),
        assetTypes: z
          .array(
            z.enum(["equity", "crypto", "fx", "etf", "index", "commodity"])
          )
          .max(3, "filters.assetTypes supports at most three entries")
          .optional(),
      })
      .default({}),
    limit: z
      .number()
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(25, "limit cannot exceed 25 results")
      .default(10),
  })
  .default({ filters: {}, limit: 10 });

/** Parse an ISO string or epoch literal from a query parameter. */
const parseTimestampParam = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    return Math.floor(numeric);
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return Math.floor(parsed / 1000);
};

/**
 * Deep clone helper used to keep the intercepted preference payloads immutable
 * between PATCH requests. JSON round-tripping is sufficient because the
 * structure only contains primitives and arrays.
 */
const clonePreferences = (
  preferences: FinancePreferences
): FinancePreferences => JSON.parse(JSON.stringify(preferences));

/** Asset metadata mirroring the fixtures consumed by the UI artefacts. */
const MOCK_ASSET_METADATA: Record<FinanceSymbol, {
  exchange: string;
  currency: string;
  type: "equity" | "crypto" | "fx";
  name: string;
}> = {
  AAPL: { exchange: "NASDAQ", currency: "USD", type: "equity", name: "Apple Inc." },
  NVDA: {
    exchange: "NASDAQ",
    currency: "USD",
    type: "equity",
    name: "NVIDIA Corporation",
  },
  BTCUSD: {
    exchange: "COINBASE",
    currency: "USD",
    type: "crypto",
    name: "Bitcoin / US Dollar",
  },
  ETHUSD: {
    exchange: "COINBASE",
    currency: "USD",
    type: "crypto",
    name: "Ethereum / US Dollar",
  },
  EURUSD: {
    exchange: "OANDA",
    currency: "USD",
    type: "fx",
    name: "Euro / US Dollar",
  },
};

/**
 * Attach Playwright routes that short-circuit the `/api/finance/*` endpoints and
 * feed the UI with the hermetic fixtures from `lib/finance/mock-data.ts`. The
 * server already consumes the same mocks, but intercepting here guarantees the
 * browser never reaches for network resources during end-to-end runs.
 */
export async function setupFinanceApiMocks(
  page: Page
): Promise<FinanceMocksHandle> {
  const baseURL =
    process.env.PLAYWRIGHT_TEST_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3100}`;

  let currentPreferences = clonePreferences(DEFAULT_FINANCE_PREFERENCES);
  let createdAtIso: string | undefined;
  let updatedAtIso: string | undefined;

  const intercepts: FinanceMocksHandle = {
    preferencesGet: 0,
    preferencesPatch: 0,
    history: 0,
    fundamentals: 0,
    news: 0,
    backtest: 0,
    quote: 0,
    screen: 0,
    getPreferences: () => clonePreferences(currentPreferences),
    setPreferences: async (preferences: FinancePreferences) => {
      currentPreferences = clonePreferences(preferences);
      createdAtIso = createdAtIso ?? FIXED_NOW_ISO;
      updatedAtIso = FIXED_NOW_ISO;

      const response = await page.context().request.patch(
        `${baseURL}/api/finance/preferences`,
        {
          data: preferences,
        }
      );

      if (!response.ok()) {
        const detail = await response.text();
        throw new Error(
          `Failed to persist mocked finance preferences (${response.status()}): ${detail}`
        );
      }
    },
  };

  await page.addInitScript((iso: string) => {
    const fixed = Date.parse(iso);
    const OriginalDate = Date;
    class FixedDate extends OriginalDate {
      constructor(...args: ConstructorParameters<typeof OriginalDate>) {
        // When Playwright instantiates the mocked Date without arguments we must return the
        // frozen timestamp; relying on args[0] keeps TypeScript happy with the variadic overloads.
        if (args[0] === undefined) {
          super(fixed);
        } else {
          super(...args);
        }
      }

      static now() {
        return fixed;
      }
    }
    FixedDate.parse = OriginalDate.parse;
    FixedDate.UTC = OriginalDate.UTC;
    Object.setPrototypeOf(FixedDate, OriginalDate);
    // @ts-expect-error overriding global constructor for determinism
    window.Date = FixedDate;
  }, FIXED_NOW_ISO);

  await page.route("**/api/finance/preferences**", async (route) => {
    const method = route.request().method();

    if (method === "GET") {
      const payload: Record<string, unknown> = {
        preferences: currentPreferences,
        rateLimit: MOCK_RATE_LIMIT,
        source: createdAtIso ? "database" : "default",
      };

      if (createdAtIso) {
        payload.createdAt = createdAtIso;
      }

      if (updatedAtIso) {
        payload.updatedAt = updatedAtIso;
      }

      intercepts.preferencesGet += 1;

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
      return;
    }

    if (method === "PATCH") {
      let json: unknown;

      try {
        json = await route.request().postDataJSON();
      } catch {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "bad_request:api",
              message: "Le corps de la requête doit être un JSON valide.",
            },
          }),
        });
        return;
      }

      const parsed = financePreferencesSchema.safeParse(json);

      if (!parsed.success) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "bad_request:api",
              message: parsed.error.issues.map((issue) => issue.message).join("; "),
            },
          }),
        });
        return;
      }

      currentPreferences = clonePreferences(parsed.data);
      createdAtIso = createdAtIso ?? FIXED_NOW_ISO;
      updatedAtIso = FIXED_NOW_ISO;

      const upstreamResponse = await route.fetch();

      intercepts.preferencesPatch += 1;

      if (!upstreamResponse.ok) {
        const body = await upstreamResponse.text();
        await route.fulfill({
          // Playwright exposes status as a function; call it to obtain the numeric code.
          status: upstreamResponse.status(),
          headers: upstreamResponse.headers(),
          body,
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          preferences: currentPreferences,
          createdAt: createdAtIso,
          updatedAt: updatedAtIso,
          rateLimit: MOCK_RATE_LIMIT,
          source: "database",
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.route("**/api/finance/quote**", async (route) => {
    const url = new URL(route.request().url());
    const symbolParam = url.searchParams.get("symbol") ?? "AAPL";
    const symbol = symbolParam.trim().toUpperCase() as FinanceSymbol;
    const metadata = MOCK_ASSET_METADATA[symbol];
    const series = FINANCE_SERIES[symbol];

    if (!metadata || !series?.length) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "bad_request:api",
            message: `Unsupported symbol '${symbolParam}'.`,
          },
        }),
      });
      return;
    }

    const lastCandle = series.at(-1);
    const fallbackTimestamp = Math.floor(Date.parse(FIXED_NOW_ISO) / 1000);

    intercepts.quote += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        exchange: metadata.exchange,
        currency: metadata.currency,
        price: lastCandle?.close ?? lastCandle?.open ?? 0,
        timestamp: lastCandle?.timestamp ?? fallbackTimestamp,
        rateLimit: MOCK_RATE_LIMIT,
        source: "mock",
      }),
    });
  });

  await page.route("**/api/finance/history**", async (route) => {
    const url = new URL(route.request().url());
    const symbolParam = url.searchParams.get("symbol") ?? "BTCUSD";
    const symbol = symbolParam.trim().toUpperCase() as FinanceSymbol;
    const timeframe = url.searchParams.get("timeframe")?.toUpperCase() ?? "1D";
    const series = FINANCE_SERIES[symbol];

    if (!series) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "bad_request:api",
            message: `Unsupported symbol '${symbolParam}'.`,
          },
        }),
      });
      return;
    }

    const from = parseTimestampParam(url.searchParams.get("from"));
    const to = parseTimestampParam(url.searchParams.get("to"));
    const limit = parseTimestampParam(url.searchParams.get("limit"));

    const earliest = series[0]?.timestamp ?? 0;
    const latest = series.at(-1)?.timestamp ?? earliest;
    const resolvedFrom = Math.max(from ?? earliest, earliest);
    const resolvedTo = Math.min(to ?? latest, latest);

    const windowed = series.filter(
      (candle) => candle.timestamp >= resolvedFrom && candle.timestamp <= resolvedTo
    );
    const bounded =
      limit && Number.isFinite(limit) && limit > 0
        ? windowed.slice(-Math.min(limit, windowed.length))
        : windowed;

    intercepts.history += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        timeframe,
        range: { from: resolvedFrom, to: resolvedTo },
        ohlcv: bounded.map((candle) => ({
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        })),
        count: bounded.length,
        rateLimit: MOCK_RATE_LIMIT,
        source: "mock",
      }),
    });
  });

  await page.route("**/api/finance/fundamentals**", async (route) => {
    const url = new URL(route.request().url());
    const symbolParam = url.searchParams.get("symbol") ?? "AAPL";
    const symbol = symbolParam.trim().toUpperCase() as FinanceSymbol;
    const snapshot = FUNDAMENTAL_SNAPSHOTS[symbol];
    const metadata = MOCK_ASSET_METADATA[symbol];

    if (!snapshot || !metadata) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "bad_request:api",
            message: `No fundamentals are available for '${symbolParam}'.`,
          },
        }),
      });
      return;
    }

    intercepts.fundamentals += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        exchange: metadata.exchange,
        currency: metadata.currency,
        metrics: snapshot,
        rateLimit: MOCK_RATE_LIMIT,
        source: "mock",
      }),
    });
  });

  await page.route("**/api/finance/news**", async (route) => {
    const url = new URL(route.request().url());
    const symbolParam = url.searchParams.get("symbol") ?? "NVDA";
    const symbol = symbolParam.trim().toUpperCase() as FinanceSymbol;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 3;

    const items = NEWS_ITEMS.filter((item) => item.symbol === symbol)
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
      .slice(0, Math.max(1, Math.min(limit, 10)));

    intercepts.news += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        items,
        rateLimit: MOCK_RATE_LIMIT,
        source: "mock",
      }),
    });
  });

  await page.route("**/api/finance/screen**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    const rawBody = route.request().postData() ?? "";
    let payload: unknown = {};

    if (rawBody.trim().length > 0) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "bad_request:api",
              message: "Request body must be valid JSON.",
            },
          }),
        });
        return;
      }
    }

    const parsed = screenRequestSchema.safeParse(payload);

    if (!parsed.success) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "bad_request:api",
            message: parsed.error.issues.map((issue) => issue.message).join("; "),
          },
        }),
      });
      return;
    }

    const { filters, limit } = parsed.data;
    const requestedTypes = filters.assetTypes
      ? new Set(filters.assetTypes)
      : null;
    const minMarketCap = filters.minMarketCap ?? null;
    const maxPeRatio = filters.maxPeRatio ?? null;

    const matches = Object.values(FUNDAMENTAL_SNAPSHOTS)
      .filter((snapshot) => {
        if (minMarketCap && snapshot.marketCap < minMarketCap) {
          return false;
        }

        if (
          maxPeRatio &&
          snapshot.peRatio > 0 &&
          snapshot.peRatio > maxPeRatio
        ) {
          return false;
        }

        if (requestedTypes && requestedTypes.size > 0) {
          const metadata = MOCK_ASSET_METADATA[snapshot.symbol as FinanceSymbol];
          if (!metadata || !requestedTypes.has(metadata.type)) {
            return false;
          }
        }

        return true;
      })
      .map((snapshot) => {
        const metadata = MOCK_ASSET_METADATA[snapshot.symbol as FinanceSymbol];
        return {
          symbol: snapshot.symbol,
          name: metadata?.name ?? snapshot.symbol,
          type: metadata?.type ?? "equity",
          exchange: metadata?.exchange ?? "MOCK",
          marketCap: snapshot.marketCap,
          peRatio: snapshot.peRatio,
          dividendYield: snapshot.dividendYield,
        };
      })
      .sort((a, b) => b.marketCap - a.marketCap);

    intercepts.screen += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "finance.screen" as const,
        totalMatches: matches.length,
        results: matches.slice(0, limit),
        appliedFilters: {
          minMarketCap: minMarketCap ?? null,
          maxPeRatio: maxPeRatio ?? null,
          assetTypes: filters.assetTypes ?? [],
        },
        rateLimit: MOCK_RATE_LIMIT,
        source: "mock",
      }),
    });
  });

  await page.route("**/api/finance/backtest**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    const body = (await route.request().postDataJSON()) as {
      symbol: string;
      timeframe?: string;
      period: { from: string; to: string };
      strategy: {
        type: "sma-crossover";
        name?: string;
        description?: string;
        params: { fastPeriod: number; slowPeriod: number };
      };
      risk: BacktestParameters["risk"];
    };

    const symbol = body.symbol.trim().toUpperCase() as FinanceSymbol;
    const series = FINANCE_SERIES[symbol];

    if (!series) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "bad_request:api",
            message: `Unsupported symbol '${body.symbol}'.`,
          },
        }),
      });
      return;
    }

    const from = Date.parse(body.period.from) / 1000;
    const to = Date.parse(body.period.to) / 1000;
    const candles = series.filter(
      (candle) => candle.timestamp >= from && candle.timestamp <= to
    );

    const params: BacktestParameters = {
      strategy: {
        type: "sma-crossover",
        params: {
          fastPeriod: body.strategy.params.fastPeriod,
          slowPeriod: body.strategy.params.slowPeriod,
        },
      },
      risk: body.risk,
    };

    const result = runBacktest(candles, params);

    const normalisedPeriod = {
      /** Preserve the canonical ISO shape expected by the finance artefact schema. */
      from: new Date(from * 1000).toISOString(),
      to: new Date(to * 1000).toISOString(),
    };

    intercepts.backtest += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "finance.backtest",
        runId: `bt_mock_${symbol.toLowerCase()}`,
        symbol,
        timeframe: (body.timeframe ?? "1D").toUpperCase(),
        period: normalisedPeriod,
        strategy: {
          id: `strategy_${symbol.toLowerCase()}`,
          versionId: `strategy_${symbol.toLowerCase()}_v1`,
          name: body.strategy.name ?? "SMA crossover",
          type: body.strategy.type,
          params: body.strategy.params,
          description: body.strategy.description,
        },
        assetId: `asset_${symbol.toLowerCase()}`,
        risk: body.risk,
        metrics: result.metrics,
        trades: result.trades,
        equityCurve: result.equityCurve,
        rateLimit: MOCK_RATE_LIMIT,
        source: "mock",
      }),
    });
  });

  return intercepts;
}
