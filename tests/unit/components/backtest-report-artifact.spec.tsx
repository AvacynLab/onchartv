import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BacktestReportArtifact } from "@/components/finance/backtest-report-artifact";
import type { FinanceBacktestArtifact } from "@/lib/finance/types";

const baseArtifact: FinanceBacktestArtifact = {
  type: "finance.backtest",
  runId: "run-1",
  symbol: "AAPL",
  timeframe: "1D",
  period: { from: "2024-01-01", to: "2024-06-30" },
  strategy: {
    type: "sma-crossover",
    params: { fastPeriod: 20, slowPeriod: 50 },
  },
  metrics: {
    totalReturn: 0.32,
    cagr: 0.18,
    maxDrawdown: 0.12,
    winRate: 0.55,
    averageWin: 1500,
    averageLoss: -700,
    sharpe: 1.1,
    profitFactor: 1.8,
    trades: 9,
  },
  equityCurve: Array.from({ length: 5 }).map((_, index) => ({
    t: 1_700_000_000 + index * 86_400,
    e: 100_000 + index * 1_500,
  })),
  trades: Array.from({ length: 9 }).map((_, index) => ({
    entryTimestamp: 1_700_000_000 + index * 172_800,
    exitTimestamp: 1_700_000_000 + index * 172_800 + 86_400,
    entryPrice: 170 + index,
    exitPrice: 171 + index,
    quantity: 1,
    grossPnl: 150,
    netPnl: index % 2 === 0 ? 120 : -80,
  })),
  commentary: "Stratégie rentable avec un drawdown contenu.",
};

describe("BacktestReportArtifact", () => {
  it("renders the artefact with accessible sections", () => {
    render(<BacktestReportArtifact artifact={baseArtifact} />);

    expect(
      screen.getByRole("heading", { name: "AAPL · 1D" })
    ).toBeInTheDocument();

    const tradeTable = screen.getByRole("table", {
      name: /historique paginé des positions/i,
    });
    expect(tradeTable).toBeInTheDocument();

    const retestButton = screen.getByRole("button", {
      name: /re-tester avec ces paramètres/i,
    });
    expect(retestButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByText(/La courbe représente l’évolution du capital net/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Page 1 /)).toBeInTheDocument();
  });

  it("validates the retest form before dispatching", async () => {
    const user = userEvent.setup();
    const handleRetest = vi.fn();

    render(
      <BacktestReportArtifact
        artifact={baseArtifact}
        onRetest={handleRetest}
      />
    );

    await user.click(
      screen.getByRole("button", { name: /re-tester avec ces paramètres/i })
    );

    const symbolInput = screen.getByLabelText(/symbole/i);
    await user.clear(symbolInput);

    await user.click(
      screen.getByRole("button", { name: /lancer un nouveau backtest/i })
    );

    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent(
      "Le symbole est requis pour relancer le backtest."
    );
    expect(handleRetest).not.toHaveBeenCalled();
  });

  it("sends sanitized retest parameters", async () => {
    const user = userEvent.setup();
    const handleRetest = vi.fn();

    render(
      <BacktestReportArtifact
        artifact={baseArtifact}
        onRetest={handleRetest}
      />
    );

    await user.click(
      screen.getByRole("button", { name: /re-tester avec ces paramètres/i })
    );

    const symbolInput = screen.getByLabelText(/symbole/i);
    await user.clear(symbolInput);
    fireEvent.input(symbolInput, { target: { value: " aapl " } });

    const timeframeSelect = screen.getByLabelText(/unité de temps/i);
    fireEvent.change(timeframeSelect, { target: { value: "4H" } });

    const startInput = screen.getByLabelText(/^début/i);
    await user.clear(startInput);
    fireEvent.input(startInput, { target: { value: "2023-01-01" } });

    const endInput = screen.getByLabelText(/^fin/i);
    await user.clear(endInput);
    fireEvent.input(endInput, { target: { value: "2023-12-31" } });

    const fastInput = screen.getByLabelText(/SMA rapide/i);
    await user.clear(fastInput);
    fireEvent.input(fastInput, { target: { value: "25" } });

    const slowInput = screen.getByLabelText(/SMA lente/i);
    await user.clear(slowInput);
    fireEvent.input(slowInput, { target: { value: "90" } });

    await user.click(
      screen.getByRole("button", { name: /lancer un nouveau backtest/i })
    );

    expect(handleRetest).toHaveBeenCalledTimes(1);
    const payload = handleRetest.mock.calls[0]?.[0] as
      | FinanceBacktestArtifact
      | undefined;
    expect(payload?.symbol).toBe("AAPL");
    expect(payload?.timeframe).toBe("4H");
    expect(payload?.period).toEqual({ from: "2023-01-01", to: "2023-12-31" });
    if (payload?.strategy.type === "sma-crossover") {
      expect(payload.strategy.params).toEqual({ fastPeriod: 25, slowPeriod: 90 });
    } else {
      throw new Error("Expected SMA crossover strategy");
    }
    expect(
      screen.getByRole("button", { name: /re-tester avec ces paramètres/i })
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("paginates the trade journal with accessible controls", async () => {
    const user = userEvent.setup();

    render(<BacktestReportArtifact artifact={baseArtifact} />);

    const table = screen.getByRole("table", {
      name: /historique paginé des positions/i,
    });
    expect(within(table).getAllByRole("row")).toHaveLength(9);

    await user.click(screen.getByRole("button", { name: /page suivante/i }));

    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText("178")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /page précédente/i }));
    expect(
      within(table).getByText(baseArtifact.trades[0]!.entryPrice.toString())
    ).toBeInTheDocument();
  });
});
