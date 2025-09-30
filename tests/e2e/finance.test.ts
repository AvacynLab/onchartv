import { expect, test } from "../fixtures";
import { ChatPage } from "../pages/chat";

/**
 * End-to-end coverage dedicated to the finance artefact surface. Each scenario
 * mirrors the high-level workflow described in the product brief: interactive
 * charting, backtesting, fundamentals/news context, and user preferences.
 */
test.describe("Finance artefacts", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await chatPage.createNewChat();
  });

  test("streams a BTCUSD chart with interactive details", async ({ page }) => {
    await chatPage.sendUserMessage("Montre BTCUSD 1D avec SMA(50/200)");
    await chatPage.isGenerationComplete();

    const chart = page.getByTestId("finance-chart-artifact");
    await expect(chart).toBeVisible();

    const canvas = chart.locator("canvas").first();
    await canvas.waitFor({ state: "visible" });
    await canvas.click({ position: { x: 40, y: 40 } });

    const details = page.getByTestId("finance-chart-details");
    await expect(details).toBeVisible();
    await expect(details).toContainText("BTCUSD");
  });

  test("runs an SMA crossover backtest and renders metrics", async ({ page }) => {
    await chatPage.sendUserMessage("Backteste SMA 50/200 sur AAPL 2018-2020");
    await chatPage.isGenerationComplete();

    const backtest = page.getByTestId("finance-backtest-artifact");
    await expect(backtest).toBeVisible();
    const totalReturnText = await page
      .getByTestId("metric-totalReturn")
      .locator("p.text-2xl")
      .innerText();
    const totalReturnValue = Number.parseFloat(totalReturnText.replace("%", ""));
    expect(totalReturnValue).toBeGreaterThan(0);

    await expect(page.getByTestId("metric-maxDrawdown")).toBeVisible();
    await expect(backtest.locator("svg polyline")).toBeVisible();
    await expect(backtest.locator("tbody tr").first()).toBeVisible();
  });

  test("surfaces fundamentals and news for NVDA", async ({ page }) => {
    await chatPage.sendUserMessage("Montre fondamentaux + 3 dernières news de NVDA");
    await chatPage.isGenerationComplete();

    const fundamentals = page.getByTestId("finance-fundamentals-artifact");
    const news = page.getByTestId("finance-news-artifact");

    await expect(fundamentals).toBeVisible();
    await expect(fundamentals).toContainText("NVDA");
    await expect(news).toBeVisible();
    await expect(news.getByRole("link").first()).toBeVisible();
  });

  test("honours the news visibility preference toggle", async ({ page }) => {
    const settingsUrl = "/settings/finance";

    const disableNews = async () => {
      await page.goto(settingsUrl);
      await expect(page.getByTestId("finance-settings")).toBeVisible();

      const toggle = page.getByLabel("Afficher les news par défaut");
      if (await toggle.isChecked()) {
        await toggle.uncheck();
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await expect(page.getByTestId("toast")).toContainText(
          "Préférences enregistrées."
        );
      }
    };

    const enableNews = async () => {
      await page.goto(settingsUrl);
      await expect(page.getByTestId("finance-settings")).toBeVisible();
      const toggle = page.getByLabel("Afficher les news par défaut");
      if (!(await toggle.isChecked())) {
        await toggle.check();
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await expect(page.getByTestId("toast")).toContainText(
          "Préférences enregistrées."
        );
      }
    };

    await disableNews();

    try {
      await chatPage.createNewChat();
      await chatPage.sendUserMessage(
        "Montre fondamentaux + 3 dernières news de NVDA"
      );
      await chatPage.isGenerationComplete();

      const fundamentals = page.getByTestId("finance-fundamentals-artifact");
      const news = page.getByTestId("finance-news-artifact");

      await expect(fundamentals).toBeVisible();
      await expect(news).toBeVisible();
      await expect(news).toContainText("Aucune actualité récente");
    } finally {
      await enableNews();
    }
  });
});
