import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import { ChatPage } from "../pages/chat";

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
 * Deterministic timestamp used to freeze the clock in browser-land so date based
 * assertions (news publication time, chart tooltips) remain stable across runs.
 */
const FIXED_NOW_ISO = "2025-03-01T12:00:00Z";

const MOCK_ASSET_METADATA: Record<FinanceSymbol, { exchange: string; currency: string }> = {
  AAPL: { exchange: "NASDAQ", currency: "USD" },
  NVDA: { exchange: "NASDAQ", currency: "USD" },
  BTCUSD: { exchange: "COINBASE", currency: "USD" },
  ETHUSD: { exchange: "COINBASE", currency: "USD" },
  EURUSD: { exchange: "OANDA", currency: "USD" },
};

/** Mock rate-limit metadata shared by every intercepted finance endpoint. */
const MOCK_RATE_LIMIT = { remaining: 42, reset: Date.parse(FIXED_NOW_ISO) + 60_000 };

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
const clonePreferences = (preferences: FinancePreferences): FinancePreferences =>
  JSON.parse(JSON.stringify(preferences));

/**
 * Attach Playwright routes that short-circuit the `/api/finance/*` endpoints and
 * feed the UI with the hermetic fixtures from `lib/finance/mock-data.ts`. The
 * server already consumes the same mocks, but intercepting here guarantees the
 * browser never reaches for network resources during e2e runs.
 */
async function setupFinanceApiMocks(page: Page) {
  await page.addInitScript((iso: string) => {
    const fixed = Date.parse(iso);
    const OriginalDate = Date;
    class FixedDate extends OriginalDate {
      constructor(...args: ConstructorParameters<typeof OriginalDate>) {
        if (args.length === 0) {
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

  let currentPreferences = clonePreferences(DEFAULT_FINANCE_PREFERENCES);
  let createdAtIso: string | undefined;
  let updatedAtIso: string | undefined;

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

  await page.route("**/api/finance/history**", async (route) => {
    const url = new URL(route.request().url());
    const symbolParam = url.searchParams.get("symbol") ?? "BTCUSD";
    const timeframe = (url.searchParams.get("timeframe") ?? "1D").toUpperCase();
    const symbol = symbolParam.trim().toUpperCase() as FinanceSymbol;
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

    if (timeframe !== "1D") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "bad_request:api",
            message: "Only 1D candles are available in the offline catalogue.",
          },
        }),
      });
      return;
    }

    const from = parseTimestampParam(url.searchParams.get("from"));
    const to = parseTimestampParam(url.searchParams.get("to"));
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

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

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "finance.backtest",
        runId: `bt_mock_${symbol.toLowerCase()}`,
        symbol,
        timeframe: (body.timeframe ?? "1D").toUpperCase(),
        period: { from, to },
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
}

/**
 * Helper extracting a numeric value from a metric card ("12.34%" → 12.34). The
 * conversion keeps assertions readable while handling both percentages and raw
 * ratios.
 */
const extractMetricValue = async (locator: Locator) => {
  const text = (await locator.innerText()).replace(/[%\s]/g, "");
  return Number.parseFloat(text);
};

test.describe("Finance end-to-end journeys", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await setupFinanceApiMocks(page);
    await chatPage.createNewChat();
  });

  test("streams a BTCUSD chart and exposes interactive controls", async ({ page }) => {
    await chatPage.sendUserMessage("Montre BTCUSD 1D avec SMA(50/200)");
    await chatPage.isGenerationComplete();

    const chart = page.getByTestId("finance-chart-artifact");
    await expect(chart).toBeVisible();
    await expect(chart).toContainText("BTCUSD");

    const canvas = chart.locator("canvas").first();
    await canvas.waitFor({ state: "visible" });
    await canvas.click({ position: { x: 80, y: 140 } });

    const details = page.getByTestId("finance-chart-details");
    await expect(details).toBeVisible();
    await expect(details).toContainText("Ouverture");
    await expect(details).toContainText("BTCUSD");

    const overlayToggle = page.getByRole("button", { name: "SMA (50)" });
    await expect(overlayToggle).toHaveAttribute("aria-pressed", "true");
    await overlayToggle.click();
    await expect(overlayToggle).toHaveAttribute("aria-pressed", "false");
    await overlayToggle.click();
    await expect(overlayToggle).toHaveAttribute("aria-pressed", "true");
  });

  test("runs the SMA backtest and renders key metrics", async ({ page }) => {
    await chatPage.sendUserMessage("Backteste SMA 50/200 sur AAPL 2018-01-01 → 2020-12-31");
    await chatPage.isGenerationComplete();

    const backtest = page.getByTestId("finance-backtest-artifact");
    await expect(backtest).toBeVisible();
    await expect(backtest).toContainText("AAPL");

    const totalReturn = await extractMetricValue(
      page.getByTestId("metric-totalReturn").locator("p.text-2xl")
    );
    expect(totalReturn).toBeGreaterThan(0);

    const cagr = await extractMetricValue(
      page.getByTestId("metric-cagr").locator("p.text-2xl")
    );
    expect(cagr).toBeGreaterThan(0);

    const drawdown = await extractMetricValue(
      page.getByTestId("metric-maxDrawdown").locator("p.text-2xl")
    );
    expect(drawdown).toBeGreaterThan(0);

    const winRate = await extractMetricValue(
      page.getByTestId("metric-winRate").locator("p.text-2xl")
    );
    expect(winRate).toBeGreaterThan(0);

    await expect(backtest.locator("svg polyline")).toBeVisible();
    await expect(backtest.locator("tbody tr").first()).toBeVisible();
  });

  test("surfaces fundamentals and three news items for NVDA", async ({ page }) => {
    await chatPage.sendUserMessage("Donne fondamentaux + 3 news pour NVDA");
    await chatPage.isGenerationComplete();

    const fundamentals = page.getByTestId("finance-fundamentals-artifact");
    const news = page.getByTestId("finance-news-artifact");

    await expect(fundamentals).toBeVisible();
    await expect(fundamentals).toContainText("Fondamentaux — NVDA");
    await expect(fundamentals).toContainText("Capitalisation");

    await expect(news).toBeVisible();
    /**
     * Ensure the agent really surfaced three NVDA entries (title + ISO date)
     * instead of repeating the same article. This mirrors the user phrasing
     * "3 news" from the scenario checklist.
     */
    await expect(news.locator("article")).toHaveCount(3);
    await expect(news.locator("time")).toHaveCount(3);
    await expect(news).toContainText("Sentiment");
  });

  test("honours the news visibility preference toggle", async ({ page }) => {
    const settingsUrl = "/settings/finance";

    const toggleNewsPreference = async (shouldShow: boolean) => {
      await page.goto(settingsUrl);
      await expect(page.getByTestId("finance-settings")).toBeVisible();
      const toggle = page.getByLabel("Afficher les news par défaut");
      const currentlyChecked = await toggle.isChecked();
      if (currentlyChecked !== shouldShow) {
        if (shouldShow) {
          await toggle.check();
        } else {
          await toggle.uncheck();
        }
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await expect(page.getByTestId("toast")).toContainText("Préférences enregistrées.");
      }
    };

    await toggleNewsPreference(false);

    try {
      await chatPage.createNewChat();
      await chatPage.sendUserMessage("Donne fondamentaux + 3 news pour NVDA");
      await chatPage.isGenerationComplete();

      const news = page.getByTestId("finance-news-artifact");
      await expect(news).toBeVisible();
      await expect(news).toContainText("Aucune actualité récente n'est disponible");
    } finally {
      await toggleNewsPreference(true);
    }
  });
});
