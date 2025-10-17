import type { Locator } from "@playwright/test";

import { expect, test } from "../fixtures";
import {
  setupFinanceApiMocks,
  type FinanceMocksHandle,
} from "../helpers/finance-mocks";
import { ChatPage } from "../pages/chat";

const TOAST_LOCATOR = '[data-testid="toast"], #automation-toast-bridge';

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
  let intercepts: FinanceMocksHandle;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    intercepts = await setupFinanceApiMocks(page);
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

    const details = page.getByTestId("finance-chart-details");
    await expect(details).toBeVisible();
    const detailHeading = details.locator("p.font-medium");
    const baselineHeading = (await detailHeading.innerText()).trim();

    const chartContainer = chart.getByRole("img", {
      name: /Graphique en chandeliers/i,
    });
    await chartContainer.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(detailHeading).not.toHaveText(baselineHeading);
    await expect(details).toContainText("Ouverture");
    await expect(details).toContainText("BTCUSD");

    const overlayToggle = page.getByTestId("finance-overlay-toggle-sma-50");
    await expect(overlayToggle).toHaveAttribute("aria-pressed", "true");
    await overlayToggle.click();
    await expect(overlayToggle).toHaveAttribute("aria-pressed", "false");
    await overlayToggle.click();
    await expect(overlayToggle).toHaveAttribute("aria-pressed", "true");

    const historyCheck = await page.evaluate(async () => {
      const response = await fetch("/api/finance/history?symbol=BTCUSD");
      const payload = await response.json();
      return { status: response.status, count: payload.count ?? 0 };
    });

    expect(historyCheck.status).toBe(200);
    expect(historyCheck.count).toBeGreaterThan(0);

    expect(intercepts.history).toBeGreaterThan(0);

    const quoteCheck = await page.evaluate(async () => {
      const response = await fetch("/api/finance/quote?symbol=BTCUSD");
      const payload = await response.json();
      return { status: response.status, symbol: payload.symbol ?? null };
    });

    expect(quoteCheck.status).toBe(200);
    expect(quoteCheck.symbol).toBe("BTCUSD");

    expect(intercepts.quote).toBeGreaterThan(0);
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
    /**
     * Le jeu de données synthétique reflète un scénario perdant pour SMA(50/200)
     * sur la période 2018-2020. Vérifier que le rendement et le CAGR restent
     * négatifs garantit que l'UI présente bien une étude de cas adverse tout en
     * gardant le journal des trades peuplé pour l'accessibilité.
     */
    expect(totalReturn).toBeLessThan(0);

    const cagr = await extractMetricValue(
      page.getByTestId("metric-cagr").locator("p.text-2xl")
    );
    expect(cagr).toBeLessThan(0);

    const drawdown = await extractMetricValue(
      page.getByTestId("metric-maxDrawdown").locator("p.text-2xl")
    );
    expect(drawdown).toBeGreaterThan(0);

    const winRate = await extractMetricValue(
      page.getByTestId("metric-winRate").locator("p.text-2xl")
    );
    expect(winRate).toBeGreaterThanOrEqual(0);

    await expect(page.getByTestId("finance-backtest-retest-toggle")).toBeVisible();
    await expect(backtest.locator("svg polyline")).toBeVisible();
    await expect(backtest.locator("tbody tr").first()).toBeVisible();

    const backtestCheck = await page.evaluate(async () => {
      const response = await fetch("/api/finance/backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: "AAPL",
          timeframe: "1D",
          period: {
            from: "2018-01-01T00:00:00Z",
            to: "2020-12-31T00:00:00Z",
          },
          strategy: {
            type: "sma-crossover" as const,
            params: { fastPeriod: 50, slowPeriod: 200 },
          },
          risk: { initialCapital: 10_000 },
        }),
      });
      const payload = await response.json();
      return { status: response.status, type: payload.type ?? null };
    });

    expect(backtestCheck.status).toBe(200);
    expect(backtestCheck.type).toBe("finance.backtest");

    expect(intercepts.backtest).toBeGreaterThan(0);
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

    const fundamentalsCheck = await page.evaluate(async () => {
      const response = await fetch("/api/finance/fundamentals?symbol=NVDA");
      const payload = await response.json();
      return {
        status: response.status,
        metricCount: payload.metrics ? Object.keys(payload.metrics).length : 0,
      };
    });

    expect(fundamentalsCheck.status).toBe(200);
    expect(fundamentalsCheck.metricCount).toBeGreaterThan(0);

    const newsCheck = await page.evaluate(async () => {
      const response = await fetch("/api/finance/news?symbol=NVDA&limit=3");
      const payload = await response.json();
      return { status: response.status, count: Array.isArray(payload.items) ? payload.items.length : 0 };
    });

    expect(newsCheck.status).toBe(200);
    expect(newsCheck.count).toBe(3);

    expect(intercepts.fundamentals).toBeGreaterThan(0);
    expect(intercepts.news).toBeGreaterThan(0);

    const screenCheck = await page.evaluate(async () => {
      const response = await fetch("/api/finance/screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: { minMarketCap: 1e11, assetTypes: ["equity"] },
          limit: 5,
        }),
      });
      const payload = await response.json();
      return {
        status: response.status,
        type: payload.type ?? null,
        totalMatches: payload.totalMatches ?? 0,
      };
    });

    expect(screenCheck.status).toBe(200);
    expect(screenCheck.type).toBe("finance.screen");
    expect(screenCheck.totalMatches).toBeGreaterThan(0);

    expect(intercepts.screen).toBeGreaterThan(0);
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
        await expect(page.locator(TOAST_LOCATOR).first()).toContainText(
          "Préférences enregistrées."
        );
      }
    };

    const resetNewsPreference = async () => {
      await intercepts.setPreferences({
        ...intercepts.getPreferences(),
        showNews: true,
      });

      /**
       * Update the settings UI as well so the server-side state reflects the
       * mocked preferences. Without this round-trip the browser intercept would
       * flip back to `showNews: true`, but the Next.js API would still persist
       * the previously toggled value, causing subsequent chats to keep the news
       * feed suppressed.
       */
      await toggleNewsPreference(true);
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
      await resetNewsPreference();
    }

    expect(intercepts.preferencesGet).toBeGreaterThan(0);
    expect(intercepts.preferencesPatch).toBeGreaterThan(0);
  });
});
