import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NewsList } from "@/components/finance/news-list";
import type { FinanceNewsArtifact } from "@/lib/finance/types";

const makeArtifact = (
  overrides: Partial<FinanceNewsArtifact>
): FinanceNewsArtifact => ({
  type: "finance.news",
  symbol: "AAPL",
  items: [],
  ...overrides,
});

describe("NewsList", () => {
  it("renders a neutral fallback when no items are provided", () => {
    const artifact = makeArtifact({
      symbol: " ",
      items: undefined as unknown as FinanceNewsArtifact["items"],
    });

    render(<NewsList artifact={artifact} />);

    // The heading falls back to a neutral label when the symbol is missing.
    expect(
      screen.getByText("Actualités — Instrument inconnu")
    ).toBeInTheDocument();

    // Users receive an explicit empty state instead of a blank container.
    expect(
      screen.getByText("Aucune actualité récente n'est disponible pour ce titre.")
    ).toBeInTheDocument();
  });

  it("gracefully handles partially populated news entries", () => {
    const artifact = makeArtifact({
      symbol: "NVDA",
      items: [
        {
          id: "with-url",
          title: "Rapport trimestriel solide",
          summary: "La marge brute progresse de 200 points de base.",
          source: "Hermes",
          url: "https://example.com/news", // Valid URL should surface as a link.
          sentiment: "positive",
          publishedAt: "2024-03-10T00:00:00Z",
        },
        {
          id: undefined,
          title: " ",
          summary: "",
          source: "",
          url: "",
          sentiment: "unknown" as unknown as "positive",
          publishedAt: "not-a-date",
        },
      ],
    });

    render(<NewsList artifact={artifact} />);

    // The first article exposes an accessible link for the external resource.
    expect(
      screen.getByRole("link", { name: "Ouvrir l'article Rapport trimestriel solide" })
    ).toBeInTheDocument();

    // The second entry falls back to a muted span, avoiding a broken anchor.
    const fallbackTitle = screen.getByText("Titre indisponible");
    expect(fallbackTitle.closest("a")).toBeNull();

    // Summary and metadata fall back to informative placeholders.
    expect(
      screen.getByText("Résumé indisponible pour cet article.")
    ).toBeInTheDocument();
    expect(screen.getByText("Source inconnue")).toBeInTheDocument();
    expect(screen.getByText("Date inconnue")).toBeInTheDocument();

    // Sentiment badges degrade to the neutral label when the payload is invalid.
    expect(screen.getByText("Sentiment : neutral")).toBeInTheDocument();
  });
});
