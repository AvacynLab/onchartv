import { expect, test } from "../fixtures";
import { setupFinanceApiMocks } from "../helpers/finance-mocks";
import { ChatPage } from "../pages/chat";

/**
 * Accessibility-focused regression ensuring the finance artefacts remain
 * keyboard navigable. The scenarios mirror the primary workflows (charting,
 * backtesting, fundamentals/news) while explicitly asserting that interactive
 * controls accept focus without relying on pointer interactions.
 */
test.describe("Finance artefacts accessibility", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await setupFinanceApiMocks(page);
    await chatPage.createNewChat();
  });

  test("exposes focusable controls across finance artefacts", async ({ page }) => {
    await chatPage.sendUserMessage("Montre BTCUSD 1D avec SMA(50/200)");
    await chatPage.isGenerationComplete();

    const zoomPreset = page.getByRole("button", { name: "Zoom 1M" });
    await expect(zoomPreset).toBeVisible();
    await zoomPreset.focus();
    await expect(zoomPreset).toBeFocused();

    const overlayToggle = page.getByTestId("finance-overlay-toggle-sma-50");
    await expect(overlayToggle).toBeVisible();
    await overlayToggle.focus();
    await expect(overlayToggle).toBeFocused();

    await chatPage.sendUserMessage("Backteste SMA 50/200 sur AAPL 2018-01-01 → 2020-12-31");
    await chatPage.isGenerationComplete();

    const retestButton = page.getByRole("button", { name: /Re-tester avec ces paramètres/ });
    await expect(retestButton).toBeVisible();
    await retestButton.focus();
    await expect(retestButton).toBeFocused();

    const nextPageButton = page.getByRole("button", { name: "Suivant" });
    await expect(nextPageButton).toBeVisible();
    await nextPageButton.focus();
    await expect(nextPageButton).toBeFocused();

    await chatPage.sendUserMessage("Donne fondamentaux + 3 news pour NVDA");
    await chatPage.isGenerationComplete();

    const externalLink = page.getByRole("link", { name: /Ouvrir l'article/ }).first();
    await expect(externalLink).toBeVisible();
    await externalLink.focus();
    await expect(externalLink).toBeFocused();
  });
});
