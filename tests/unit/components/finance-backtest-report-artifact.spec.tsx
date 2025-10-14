import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BacktestReportArtifact } from "@/components/finance/backtest-report-artifact";
import type { FinanceBacktestArtifact } from "@/lib/finance/types";

/**
 * Fabrique un artefact de backtest minimal stable pour les tests UI. Les valeurs
 * sont volontairement petites pour simplifier les assertions textuelles.
 */
const makeArtifact = (overrides: Partial<FinanceBacktestArtifact> = {}) =>
  ({
    type: "finance.backtest" as const,
    runId: "run-001",
    symbol: "AAPL",
    timeframe: "1D",
    period: { from: "2024-01-01", to: "2024-03-01" },
    strategy: {
      type: "sma-crossover" as const,
      params: { fastPeriod: 20, slowPeriod: 50 },
    },
    metrics: {
      totalReturn: 0.125,
      cagr: 0.08,
      maxDrawdown: -0.12,
      winRate: 0.6,
      averageWin: 0.03,
      averageLoss: -0.015,
      sharpe: 1.75,
      profitFactor: 1.8,
      trades: 4,
      ...((overrides.metrics ?? {}) as FinanceBacktestArtifact["metrics"]),
    },
    equityCurve: [
      { t: 1_704_889_600, e: 100_000 },
      { t: 1_705_664_000, e: 103_000 },
      { t: 1_706_438_400, e: 105_500 },
    ],
    trades: [
      {
        entryTimestamp: 1_704_889_600,
        exitTimestamp: 1_705_664_000,
        entryPrice: 170,
        exitPrice: 180,
        quantity: 10,
        grossPnl: 100,
        netPnl: 95,
      },
      {
        entryTimestamp: 1_705_664_000,
        exitTimestamp: 1_706_438_400,
        entryPrice: 180,
        exitPrice: 176,
        quantity: 5,
        grossPnl: -20,
        netPnl: -22,
      },
    ],
    commentary: "Stratégie SMA 20/50 exécutée sur Q1 2024.",
    ...overrides,
  }) satisfies FinanceBacktestArtifact;

describe("BacktestReportArtifact", () => {
  it("affiche les métriques clés avec unités explicites", () => {
    render(<BacktestReportArtifact artifact={makeArtifact()} />);

    expect(
      screen.getByTestId("metric-totalReturn-value")
    ).toHaveTextContent("12.50%");
    expect(
      screen.getByTestId("metric-profitFactor-value")
    ).toHaveTextContent("1.80");

    const totalReturnCard = screen.getByTestId("metric-totalReturn");
    expect(
      within(totalReturnCard).getByText("(%)", { exact: false })
    ).toBeInTheDocument();
  });

  it("signale une erreur de validation lorsque le symbole est vide", async () => {
    const user = userEvent.setup();
    render(<BacktestReportArtifact artifact={makeArtifact()} />);

    await user.click(
      screen.getByTestId("finance-backtest-retest-toggle")
    );

    const symbolInput = screen.getByLabelText("Symbole");
    await user.clear(symbolInput);
    await user.click(
      screen.getByRole("button", { name: "Lancer un nouveau backtest" })
    );

    expect(
      screen.getByRole("alert")
    ).toHaveTextContent("Le symbole est requis");
  });

  it("expose le bouton de re-test via un nom accessible stable", () => {
    render(<BacktestReportArtifact artifact={makeArtifact()} />);

    expect(
      screen.getByRole("button", {
        name: /Re-tester avec ces paramètres/,
      })
    ).toBeVisible();
  });

  it("transmet un payload normalisé lors d'un re-test valide", async () => {
    const onRetest = vi.fn();
    const user = userEvent.setup();
    const artifact = makeArtifact();
    render(
      <BacktestReportArtifact artifact={artifact} onRetest={onRetest} />
    );

    await user.click(
      screen.getByTestId("finance-backtest-retest-toggle")
    );

    await user.clear(screen.getByLabelText("Symbole"));
    await user.type(screen.getByLabelText("Symbole"), " ethusd ");
    await user.selectOptions(screen.getByLabelText("Unité de temps"), "4H");
    await user.clear(screen.getByLabelText("Début"));
    await user.type(screen.getByLabelText("Début"), "2023-01-01");
    await user.clear(screen.getByLabelText("Fin"));
    await user.type(screen.getByLabelText("Fin"), "2023-12-31");
    await user.clear(screen.getByLabelText("SMA rapide"));
    await user.type(screen.getByLabelText("SMA rapide"), "30");
    await user.clear(screen.getByLabelText("SMA lente"));
    await user.type(screen.getByLabelText("SMA lente"), "90");

    await user.click(
      screen.getByRole("button", { name: "Lancer un nouveau backtest" })
    );

    expect(onRetest).toHaveBeenCalledTimes(1);
    const payload = onRetest.mock.calls[0][0] as FinanceBacktestArtifact;
    expect(payload.symbol).toBe("ETHUSD");
    expect(payload.timeframe).toBe("4H");
    expect(payload.period).toEqual({ from: "2023-01-01", to: "2023-12-31" });
    expect(payload.strategy).toEqual({
      ...artifact.strategy,
      params: { fastPeriod: 30, slowPeriod: 90 },
    });
  });
});

