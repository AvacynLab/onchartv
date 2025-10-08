import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FundamentalsCard } from "@/components/finance/fundamentals-card";
import type { FinanceFundamentalsArtifact } from "@/lib/finance/types";

const makeArtifact = (
  overrides: Partial<FinanceFundamentalsArtifact>
): FinanceFundamentalsArtifact => ({
  type: "finance.fundamentals",
  symbol: "AAPL",
  snapshot: {
    symbol: "AAPL",
    marketCap: 2.8e12,
    peRatio: 27.4,
    dividendYield: 0.005,
    revenueTtm: 3.83e11,
    grossMargin: 0.44,
    netMargin: 0.26,
    debtToEquity: 1.6,
  },
  highlights: [],
  ...overrides,
});

describe("FundamentalsCard", () => {
  it("renders safe fallbacks when snapshot metrics are missing", () => {
    const artifact = makeArtifact({
      symbol: "   ",
      snapshot: {} as FinanceFundamentalsArtifact["snapshot"],
      highlights: undefined as unknown as string[],
      caution: "   " as unknown as string,
    });

    render(<FundamentalsCard artifact={artifact} />);

    // Header falls back to a neutral label when the symbol is blank.
    expect(
      screen.getByText("Fondamentaux — Instrument inconnu")
    ).toBeInTheDocument();

    // Every metric tile renders the placeholder dash instead of crashing on
    // undefined numbers.
    expect(screen.getAllByText("—", { exact: true })).toHaveLength(7);
  });

  it("trims highlights and cautions sourced from partially hydrated artefacts", () => {
    const artifact = makeArtifact({
      symbol: "NVDA",
      snapshot: {
        symbol: "NVDA",
        marketCap: 2.2e12,
        peRatio: 35.1,
        dividendYield: 0.0125,
        revenueTtm: 3.9e11,
        grossMargin: 0.64,
        netMargin: 0.31,
        debtToEquity: 1.23,
      },
      highlights: ["  Croissance robuste du chiffre d'affaires  ", ""],
      caution: "  Attention au levier financier  ",
    });

    render(<FundamentalsCard artifact={artifact} />);

    // Highlight text is trimmed and displayed once.
    expect(
      screen.getByText("Croissance robuste du chiffre d'affaires")
    ).toBeInTheDocument();

    // The caution banner is rendered with the trimmed message.
    expect(screen.getByText("Attention au levier financier")).toBeInTheDocument();

    // The static provenance badge remains visible to contextualise the dataset.
    expect(screen.getAllByText(/Catalogue hermétique/)).toHaveLength(1);
  });
});
