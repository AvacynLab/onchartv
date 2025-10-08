import { describe, expect, it } from "vitest";

import {
  financeArtifactSchema,
  financeChartArtifactSchema,
  FINANCE_ARTIFACT_TYPES,
} from "@/lib/finance/types";

describe("finance artifact schemas", () => {
  it("valident un artefact de graphique minimal", () => {
    const artifact = {
      type: "finance.chart" as const,
      symbol: "AAPL",
      timeframe: "1D",
      range: { from: "2025-01-01", to: "2025-01-10" },
      ohlcv: [
        { t: 1_700_000_000, o: 170, h: 172, l: 169, c: 171, v: 1_000_000 },
      ],
      overlays: [],
    };

    expect(financeChartArtifactSchema.parse(artifact)).toEqual(artifact);
  });

  it("refuse les types d'artefact inconnus", () => {
    const result = financeArtifactSchema.safeParse({
      type: "finance.unknown",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail");
    }
    expect(result.error.issues[0]?.message).toContain("Invalid");
  });

  it("répertorie toutes les variantes discriminantes", () => {
    expect(new Set(FINANCE_ARTIFACT_TYPES)).toEqual(
      new Set([
        "finance.chart",
        "finance.chart.annotations",
        "finance.fundamentals",
        "finance.news",
        "finance.backtest",
        "finance.screen",
      ])
    );
  });
});
