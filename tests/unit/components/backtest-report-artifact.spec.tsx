import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
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
  const expectedMarkup = `<div class="space-y-6" data-testid="finance-backtest-artifact">
<header class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
<div>
<h3 class="font-semibold text-lg">AAPL · 1D</h3>
<p class="text-muted-foreground text-sm">2024-01-01 → 2024-06-30</p>
</div>
<button class="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3" type="button">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-repeat2 mr-2 size-4">
<path d="m2 9 3-3 3 3">
</path>
<path d="M13 18H7a2 2 0 0 1-2-2V6">
</path>
<path d="m22 15-3 3-3-3">
</path>
<path d="M11 6h6a2 2 0 0 1 2 2v10">
</path>
</svg>Re-tester avec ces paramètres</button>
</header>
<section class="grid gap-4 md:grid-cols-3">
<div class="rounded-lg border bg-card text-card-foreground shadow-sm" data-testid="metric-totalReturn">
<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
<div class="tracking-tight flex items-center gap-2 text-sm font-medium">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-column size-4 text-muted-foreground">
<path d="M3 3v16a2 2 0 0 0 2 2h16">
</path>
<path d="M18 17V9">
</path>
<path d="M13 17V5">
</path>
<path d="M8 17v-3">
</path>
</svg>Performance totale</div>
<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground" title="Performance cumulée entre le point d'entrée et de sortie.">?</div>
</div>
<div class="p-6 pt-0">
<p class="text-2xl font-semibold">32.00%</p>
<p class="text-muted-foreground text-xs">Synthèse calculée sur l'échantillon backtesté.</p>
</div>
</div>
<div class="rounded-lg border bg-card text-card-foreground shadow-sm" data-testid="metric-cagr">
<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
<div class="tracking-tight flex items-center gap-2 text-sm font-medium">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-column size-4 text-muted-foreground">
<path d="M3 3v16a2 2 0 0 0 2 2h16">
</path>
<path d="M18 17V9">
</path>
<path d="M13 17V5">
</path>
<path d="M8 17v-3">
</path>
</svg>CAGR</div>
<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground" title="Taux de croissance annualisé composé.">?</div>
</div>
<div class="p-6 pt-0">
<p class="text-2xl font-semibold">18.00%</p>
<p class="text-muted-foreground text-xs">Synthèse calculée sur l'échantillon backtesté.</p>
</div>
</div>
<div class="rounded-lg border bg-card text-card-foreground shadow-sm" data-testid="metric-maxDrawdown">
<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
<div class="tracking-tight flex items-center gap-2 text-sm font-medium">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-column size-4 text-muted-foreground">
<path d="M3 3v16a2 2 0 0 0 2 2h16">
</path>
<path d="M18 17V9">
</path>
<path d="M13 17V5">
</path>
<path d="M8 17v-3">
</path>
</svg>Max Drawdown</div>
<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground" title="Perte maximale observée entre un pic et le creux suivant.">?</div>
</div>
<div class="p-6 pt-0">
<p class="text-2xl font-semibold">12.00%</p>
<p class="text-muted-foreground text-xs">Synthèse calculée sur l'échantillon backtesté.</p>
</div>
</div>
<div class="rounded-lg border bg-card text-card-foreground shadow-sm" data-testid="metric-winRate">
<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
<div class="tracking-tight flex items-center gap-2 text-sm font-medium">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-column size-4 text-muted-foreground">
<path d="M3 3v16a2 2 0 0 0 2 2h16">
</path>
<path d="M18 17V9">
</path>
<path d="M13 17V5">
</path>
<path d="M8 17v-3">
</path>
</svg>Taux de réussite</div>
<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground" title="Part des trades gagnants vs total des positions fermées.">?</div>
</div>
<div class="p-6 pt-0">
<p class="text-2xl font-semibold">55.00%</p>
<p class="text-muted-foreground text-xs">9 trades</p>
</div>
</div>
<div class="rounded-lg border bg-card text-card-foreground shadow-sm" data-testid="metric-sharpe">
<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
<div class="tracking-tight flex items-center gap-2 text-sm font-medium">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-column size-4 text-muted-foreground">
<path d="M3 3v16a2 2 0 0 0 2 2h16">
</path>
<path d="M18 17V9">
</path>
<path d="M13 17V5">
</path>
<path d="M8 17v-3">
</path>
</svg>Sharpe</div>
<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground" title="Ratio de Sharpe (rendement excédentaire / volatilité).">?</div>
</div>
<div class="p-6 pt-0">
<p class="text-2xl font-semibold">1.10</p>
<p class="text-muted-foreground text-xs">Synthèse calculée sur l'échantillon backtesté.</p>
</div>
</div>
<div class="rounded-lg border bg-card text-card-foreground shadow-sm" data-testid="metric-profitFactor">
<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
<div class="tracking-tight flex items-center gap-2 text-sm font-medium">
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-column size-4 text-muted-foreground">
<path d="M3 3v16a2 2 0 0 0 2 2h16">
</path>
<path d="M18 17V9">
</path>
<path d="M13 17V5">
</path>
<path d="M8 17v-3">
</path>
</svg>Profit factor</div>
<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground" title="Rapport gains/pertes brutes – >1 indique un edge positif.">?</div>
</div>
<div class="p-6 pt-0">
<p class="text-2xl font-semibold">1.80</p>
<p class="text-muted-foreground text-xs">Synthèse calculée sur l'échantillon backtesté.</p>
</div>
</div>
</section>
<section>
<h4 class="font-semibold text-base">Courbe d'équité</h4>
<div class="mt-2 rounded-lg border bg-muted/20 p-4">
<svg aria-label="Évolution de l'équité" class="h-48 w-full" preserveAspectRatio="none" role="img" viewBox="0 0 100 100">
<polyline fill="none" points="0,100 25,75 50,50 75,25 100,0" stroke="var(--primary)" stroke-width="2">
</polyline>
</svg>
</div>
</section>
<section class="space-y-3">
<div class="flex items-center justify-between">
<h4 class="font-semibold text-base">Journal des trades</h4>
<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">9 positions</div>
</div>
<div class="overflow-x-auto">
<table class="min-w-full text-left text-sm">
<thead>
<tr class="text-muted-foreground text-xs uppercase">
<th class="px-3 py-2">Entrée</th>
<th class="px-3 py-2">Sortie</th>
<th class="px-3 py-2">Prix entrée</th>
<th class="px-3 py-2">Prix sortie</th>
<th class="px-3 py-2">Quantité</th>
<th class="px-3 py-2">PnL net</th>
</tr>
</thead>
<tbody>
<tr class="border-t">
<td class="px-3 py-2">2023-11-14</td>
<td class="px-3 py-2">2023-11-15</td>
<td class="px-3 py-2">170</td>
<td class="px-3 py-2">171</td>
<td class="px-3 py-2">1</td>
<td class="px-3 py-2 text-green-600">120</td>
</tr>
<tr class="border-t">
<td class="px-3 py-2">2023-11-16</td>
<td class="px-3 py-2">2023-11-17</td>
<td class="px-3 py-2">171</td>
<td class="px-3 py-2">172</td>
<td class="px-3 py-2">1</td>
<td class="px-3 py-2 text-red-600">-80</td>
</tr>
<tr class="border-t">
<td class="px-3 py-2">2023-11-18</td>
<td class="px-3 py-2">2023-11-19</td>
<td class="px-3 py-2">172</td>
<td class="px-3 py-2">173</td>
<td class="px-3 py-2">1</td>
<td class="px-3 py-2 text-green-600">120</td>
</tr>
<tr class="border-t">
<td class="px-3 py-2">2023-11-20</td>
<td class="px-3 py-2">2023-11-21</td>
<td class="px-3 py-2">173</td>
<td class="px-3 py-2">174</td>
<td class="px-3 py-2">1</td>
<td class="px-3 py-2 text-red-600">-80</td>
</tr>
<tr class="border-t">
<td class="px-3 py-2">2023-11-22</td>
<td class="px-3 py-2">2023-11-23</td>
<td class="px-3 py-2">174</td>
<td class="px-3 py-2">175</td>
<td class="px-3 py-2">1</td>
<td class="px-3 py-2 text-green-600">120</td>
</tr>
<tr class="border-t">
<td class="px-3 py-2">2023-11-24</td>
<td class="px-3 py-2">2023-11-25</td>
<td class="px-3 py-2">175</td>
<td class="px-3 py-2">176</td>
<td class="px-3 py-2">1</td>
<td class="px-3 py-2 text-red-600">-80</td>
</tr>
<tr class="border-t">
<td class="px-3 py-2">2023-11-26</td>
<td class="px-3 py-2">2023-11-27</td>
<td class="px-3 py-2">176</td>
<td class="px-3 py-2">177</td>
<td class="px-3 py-2">1</td>
<td class="px-3 py-2 text-green-600">120</td>
</tr>
<tr class="border-t">
<td class="px-3 py-2">2023-11-28</td>
<td class="px-3 py-2">2023-11-29</td>
<td class="px-3 py-2">177</td>
<td class="px-3 py-2">178</td>
<td class="px-3 py-2">1</td>
<td class="px-3 py-2 text-red-600">-80</td>
</tr>
</tbody>
</table>
</div>
<div class="flex items-center justify-end gap-2">
<button class="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3" disabled="" type="button">Précédent</button>
<span class="text-muted-foreground text-xs">Page 1 / 2</span>
<button class="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3" type="button">Suivant</button>
</div>
</section>
<section class="rounded-lg border bg-muted/10 p-4 text-sm">Stratégie rentable avec un drawdown contenu.</section>
</div>`;
  it("affiche les métriques clés", () => {
    render(<BacktestReportArtifact artifact={baseArtifact} />);

    expect(screen.getByTestId("metric-totalReturn")).toHaveTextContent("32.00%");
    expect(screen.getByTestId("metric-sharpe")).toHaveTextContent("1.10");
  });

  it("préserve le markup principal via snapshot", () => {
    /**
     * Le rapport de backtest contient plusieurs sections (cartes métriques,
     * graphique d'équity, pagination). Le snapshot permet de repérer un
     * changement involontaire de structure ou de libellé.
     */
    const { asFragment } = render(
      <BacktestReportArtifact artifact={baseArtifact} />
    );

    const fragment = asFragment();
    const markup = fragment.firstElementChild?.outerHTML ?? "";
    const normalizedMarkup = markup.replace(/></g, ">\n<");
    const sanitizedMarkup = normalizedMarkup
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
    const sanitizedExpected = expectedMarkup
      .split("\n")
      .map((line) => line.trim())
      .join("\n");

    expect(sanitizedMarkup).toEqual(sanitizedExpected);
  });

  it("pagine le journal des trades", async () => {
    render(<BacktestReportArtifact artifact={baseArtifact} />);

    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Suivant/ }));
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    expect(
      screen.queryByText("Aucun trade n'a été simulé sur cette période.")
    ).not.toBeInTheDocument();
  });

  it("notifie le handler de re-test lorsque l'utilisateur clique sur le bouton", async () => {
    const handleRetest = vi.fn();

    render(
      <BacktestReportArtifact
        artifact={baseArtifact}
        onRetest={handleRetest}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Re-tester avec ces paramètres/ })
    );

    expect(handleRetest).toHaveBeenCalledTimes(1);
    expect(handleRetest).toHaveBeenCalledWith(baseArtifact);
  });
});
