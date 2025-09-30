import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FundamentalsCard } from "@/components/finance/fundamentals-card";
import type { FinanceFundamentalsArtifact } from "@/lib/finance/types";

/**
 * The fundamentals artefact pairs compact figures with short explanations.
 * Locking the rendering behaviour ensures the finance assistant keeps the
 * summaries intelligible when future contributors tweak the UI.
 */
describe("FundamentalsCard", () => {
  const baseArtifact: FinanceFundamentalsArtifact = {
    type: "finance.fundamentals",
    symbol: "NVDA",
    snapshot: {
      symbol: "NVDA",
      marketCap: 2.45e12,
      peRatio: 35.2,
      dividendYield: 0.004,
      revenueTtm: 9.7e10,
      grossMargin: 0.72,
      netMargin: 0.48,
      debtToEquity: 0.35,
    },
    highlights: [
      "La division datacenter continue de représenter plus de 60% du chiffre d'affaires.",
    ],
    caution: "La valorisation reste très sensible à la demande en accélérateurs IA.",
  };

  it("renders formatted metrics alongside highlights and caution notes", () => {
    render(<FundamentalsCard artifact={baseArtifact} />);

    expect(
      screen.getByRole("heading", { name: /Fondamentaux — NVDA/i, level: 3 })
    ).toBeInTheDocument();

    const card = screen.getByTestId("finance-fundamentals-artifact");

    /**
     * Metric tiles should expose the formatted values while keeping the
     * description snippet visible to explain the ratio in plain language.
     */
    const getValue = (label: RegExp) => {
      const [labelNode] = within(card).getAllByText(label);
      return labelNode.parentElement?.nextElementSibling?.textContent ?? "";
    };

    expect(getValue(/Capitalisation/i)).toMatch(/\d/);
    expect(getValue(/PE ratio/i)).toContain("35.2");
    expect(getValue(/Dividende/i)).toContain("0.4");
    expect(getValue(/Revenus TTM/i)).toMatch(/\d/);
    expect(getValue(/Marge brute/i)).toContain("72");
    expect(getValue(/Marge nette/i)).toContain("48");
    expect(getValue(/Dette \/ Capitaux/i)).toContain("0.35");

    const highlightsHeading = within(card).getByRole("heading", {
      name: /Points saillants/i,
      level: 4,
    });
    const highlightsList = highlightsHeading.nextElementSibling as HTMLUListElement;
    expect(highlightsList).toBeTruthy();
    const highlightItems = within(highlightsList).getAllByRole("listitem");
    expect(highlightItems).toHaveLength(1);
    expect(highlightItems[0]).toHaveTextContent(/datacenter/i);

    expect(
      within(card).getByText(/La valorisation reste très sensible/i)
    ).toBeInTheDocument();
  });

  it("falls back to em dashes when certain metrics are unavailable", () => {
    const emptyArtifact: FinanceFundamentalsArtifact = {
      ...baseArtifact,
      snapshot: {
        symbol: "BTCUSD",
        marketCap: 0,
        peRatio: 0,
        dividendYield: 0,
        revenueTtm: 0,
        grossMargin: 0,
        netMargin: 0,
        debtToEquity: 0,
      },
      highlights: [],
      caution: undefined,
    };

    render(<FundamentalsCard artifact={emptyArtifact} />);

    const card = screen.getByTestId("finance-fundamentals-artifact");
    const placeholders = within(card).getAllByText("—");

    // Capitalisation, dividende, revenus et ratios doivent afficher un tiret cadratin.
    expect(placeholders.length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole("heading", { name: /Points saillants/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/La valorisation reste très sensible/i)).not.toBeInTheDocument();
  });
});
