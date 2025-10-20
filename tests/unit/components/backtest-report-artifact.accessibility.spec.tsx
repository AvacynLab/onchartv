import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";

import { BacktestReportArtifact } from "@/components/finance/backtest-report-artifact";
import type { FinanceBacktestArtifact } from "@/lib/finance/types";

const buildBacktestArtifact = (): FinanceBacktestArtifact => ({
  type: "finance.backtest",
  runId: "test-backtest",
  symbol: "AAPL",
  timeframe: "1D",
  period: { from: "2024-01-01", to: "2024-12-31" },
  strategy: {
    type: "sma-crossover",
    params: { fastPeriod: 20, slowPeriod: 50 },
  },
  metrics: {
    totalReturn: 0.22,
    cagr: 0.18,
    maxDrawdown: 0.09,
    winRate: 0.58,
    averageWin: 3200,
    averageLoss: -900,
    sharpe: 1.35,
    profitFactor: 2.1,
    trades: 6,
  },
  equityCurve: [{ t: 1_704_067_200, e: 110_000 }],
  trades: [
    {
      entryTimestamp: 1_704_067_200,
      exitTimestamp: 1_705_824_000,
      entryPrice: 150,
      exitPrice: 162,
      quantity: 8,
      grossPnl: 96,
      netPnl: 94,
    },
  ],
  commentary: "Sample backtest artifact for accessibility checks.",
});

beforeEach(() => {
  // JSDOM does not implement ResizeObserver; stub a minimal version to satisfy the component.
  class ResizeObserverMock implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this,
      );
    }

    unobserve() {}

    disconnect() {}

    takeRecords(): ResizeObserverEntry[] {
      return [];
    }
  }

  Object.defineProperty(global, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
});

describe("BacktestReportArtifact accessibility", () => {
  it("expose un tableau focalisable au sein de l'artefact", () => {
    const artifact = buildBacktestArtifact();

    render(<BacktestReportArtifact artifact={artifact} />);

    const container = screen.getByTestId("finance-backtest-artifact");
    expect(container).toBeVisible();

    const tradesTable = within(container).getByRole("table");
    expect(tradesTable).toBeVisible();

    tradesTable.focus();
    expect(tradesTable).toHaveFocus();
  });
});
