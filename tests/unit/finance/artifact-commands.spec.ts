import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";

import {
  buildBacktestSlashCommand,
  buildExplainCandlePrompt,
} from "@/lib/finance/artifact-commands";
import type {
  FinanceBacktestArtifact,
  FinanceChartArtifact,
} from "@/lib/finance/types";

const baseBacktestArtifact: FinanceBacktestArtifact = {
  type: "finance.backtest",
  runId: "run_123",
  symbol: "AAPL",
  timeframe: "1D",
  period: { from: "2020-01-01", to: "2020-12-31" },
  strategy: {
    type: "sma-crossover",
    params: { fastPeriod: 50, slowPeriod: 200 },
  },
  metrics: {
    totalReturn: 0.12,
    cagr: 0.11,
    maxDrawdown: 0.08,
    winRate: 0.52,
    averageWin: 240,
    averageLoss: -120,
    sharpe: 0.9,
    profitFactor: 1.4,
    trades: 42,
  },
  equityCurve: [],
  trades: [],
};

const baseChartArtifact: FinanceChartArtifact = {
  type: "finance.chart",
  symbol: "BTCUSD",
  timeframe: "1D",
  range: { from: "2024-01-01", to: "2024-03-31" },
  ohlcv: [],
  overlays: [
    { type: "sma", length: 50, values: [] },
    { type: "ema", length: 21, values: [] },
  ],
};

describe("finance artefact command helpers", () => {
  it("construit une commande /backtest à partir d'un artefact SMA", () => {
    const command = buildBacktestSlashCommand(baseBacktestArtifact);

    expect(command).toBe("/backtest AAPL 1D 2020-01-01 2020-12-31 50 200");
  });

  it("retourne null pour les stratégies non supportées", () => {
    const unsupported = {
      ...baseBacktestArtifact,
      strategy: { ...baseBacktestArtifact.strategy, type: "unknown" as any },
    } satisfies FinanceBacktestArtifact;

    expect(buildBacktestSlashCommand(unsupported)).toBeNull();
  });

  it("génère un prompt d'explication de bougie riche en contexte", () => {
    const timestamp = Date.UTC(2024, 0, 15) / 1_000;

    const prompt = buildExplainCandlePrompt(baseChartArtifact, timestamp);

    expect(prompt).toContain("BTCUSD");
    expect(prompt).toContain("2024-01-15");
    expect(prompt).toContain("SMA(50)");
    expect(prompt).toContain("EMA(21)");
    expect(prompt).toContain("educational");
  });
});
