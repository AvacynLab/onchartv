import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NewsList } from "@/components/finance/news-list";
import type { FinanceNewsArtifact } from "@/lib/finance/types";

/**
 * News artefacts surface curated headlines with sentiment indicators. These
 * assertions guarantee the renderer keeps external links, published dates, and
 * accessibility affordances aligned with the checklist instructions.
 */
describe("NewsList", () => {
  const baseArtifact: FinanceNewsArtifact = {
    type: "finance.news",
    symbol: "AAPL",
    items: [
      {
        id: "mock-1",
        title: "Apple étend son programme de rachat d'actions",
        summary: "Le conseil annonce un nouvel engagement de 90 Md$.",
        url: "https://example.com/news/apple-buyback",
        source: "MockWire",
        publishedAt: "2024-05-01T10:00:00.000Z",
        sentiment: "positive",
      },
      {
        id: "mock-2",
        title: "Les contraintes d'approvisionnement s'estompent",
        summary: "Les délais sur les puces M-series reviennent à la normale.",
        url: "https://example.com/news/apple-supply",
        source: "MockDaily",
        publishedAt: "2024-05-03T15:30:00.000Z",
        sentiment: "neutral",
      },
    ],
  };

  it("renders each article with sentiment iconography and external links", () => {
    render(<NewsList artifact={baseArtifact} />);

    expect(
      screen.getByRole("heading", { name: /Actualités — AAPL/i, level: 3 })
    ).toBeInTheDocument();

    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(baseArtifact.items.length);

    /**
     * The first entry should expose a positive sentiment icon, an accessible
     * tooltip link, and a publication date formatted in UTC (ISO split).
     */
    const firstArticle = articles[0];
    expect(within(firstArticle).getByLabelText(/Sentiment positif/i)).toBeVisible();
    expect(
      within(firstArticle).getByRole("link", { name: baseArtifact.items[0]!.title })
    ).toHaveAttribute("href", baseArtifact.items[0]!.url);
    expect(within(firstArticle).getByText("2024-05-01")).toBeVisible();

    const secondArticle = articles[1];
    expect(within(secondArticle).getByLabelText(/Sentiment neutre/i)).toBeVisible();
    expect(within(secondArticle).getByText("2024-05-03")).toBeVisible();
  });

  it("falls back to a placeholder when the catalogue is empty", () => {
    render(<NewsList artifact={{ ...baseArtifact, items: [] }} />);

    expect(
      screen.getByText(/Aucune actualité récente n'est disponible/i)
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });
});
