"use client";

import React from "react";
import { useMemo, useState } from "react";
import { AlertCircle, BarChart3, Repeat2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FinanceBacktestArtifact } from "@/lib/finance/types";

const TRADES_PER_PAGE = 8;

/**
 * Format a percentage metric using a consistent two-decimal precision. Values
 * are clamped to avoid displaying `NaN` when the mock data yields divisions by
 * zero (e.g. Sharpe ratio with no trades).
 */
const formatPercent = (value: number) => {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(2)}%`;
};

const formatRatio = (value: number) => {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(2);
};

const formatCurrency = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const formatDate = (timestamp: number) =>
  new Date(timestamp * 1_000).toISOString().split("T")[0];

type MetricConfig = {
  readonly id: keyof FinanceBacktestArtifact["metrics"];
  readonly label: string;
  readonly formatter: (value: number) => string;
  readonly tooltip?: string;
};

const METRICS: readonly MetricConfig[] = [
  {
    id: "totalReturn",
    label: "Performance totale",
    formatter: formatPercent,
    tooltip: "Performance cumulée entre le point d'entrée et de sortie.",
  },
  {
    id: "cagr",
    label: "CAGR",
    formatter: formatPercent,
    tooltip: "Taux de croissance annualisé composé.",
  },
  {
    id: "maxDrawdown",
    label: "Max Drawdown",
    formatter: formatPercent,
    tooltip: "Perte maximale observée entre un pic et le creux suivant.",
  },
  {
    id: "winRate",
    label: "Taux de réussite",
    formatter: formatPercent,
    tooltip: "Part des trades gagnants vs total des positions fermées.",
  },
  {
    id: "sharpe",
    label: "Sharpe",
    formatter: formatRatio,
    tooltip: "Ratio de Sharpe (rendement excédentaire / volatilité).",
  },
  {
    id: "profitFactor",
    label: "Profit factor",
    formatter: formatRatio,
    tooltip: "Rapport gains/pertes brutes – >1 indique un edge positif.",
  },
];

export interface BacktestReportArtifactProps {
  readonly artifact: FinanceBacktestArtifact;
  readonly onRetest?: (artifact: FinanceBacktestArtifact) => void;
}

const computeEquityPolyline = (artifact: FinanceBacktestArtifact) => {
  if (artifact.equityCurve.length === 0) {
    return "";
  }

  const equities = artifact.equityCurve.map((point) => point.e);
  const min = Math.min(...equities);
  const max = Math.max(...equities);
  const span = max - min || 1;

  return artifact.equityCurve
    .map((point, index) => {
      const x = (index / Math.max(artifact.equityCurve.length - 1, 1)) * 100;
      const y = 100 - ((point.e - min) / span) * 100;
      return `${x},${y}`;
    })
    .join(" ");
};

/**
 * Render the hermetic backtest artefact with metric cards, an inline equity
 * curve, and a paginated trade ledger. The component stays framework-agnostic
 * so it can be reused in tests and future dashboards.
 */
export function BacktestReportArtifact({
  artifact,
  onRetest,
}: BacktestReportArtifactProps) {
  const [pageIndex, setPageIndex] = useState(0);

  const trades = artifact.trades;
  const pageCount = Math.max(Math.ceil(trades.length / TRADES_PER_PAGE), 1);
  const paginatedTrades = useMemo(() => {
    const start = pageIndex * TRADES_PER_PAGE;
    return trades.slice(start, start + TRADES_PER_PAGE);
  }, [pageIndex, trades]);

  const equityPolyline = useMemo(
    () => computeEquityPolyline(artifact),
    [artifact]
  );

  const handleRetest = () => {
    if (onRetest) {
      onRetest(artifact);
    }
  };

  return (
    <div className="space-y-6" data-testid="finance-backtest-artifact">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-lg">
            {artifact.symbol} · {artifact.timeframe}
          </h3>
          <p className="text-muted-foreground text-sm">
            {artifact.period.from} → {artifact.period.to}
          </p>
        </div>
        <Button
          onClick={handleRetest}
          size="sm"
          type="button"
          variant="outline"
        >
          <Repeat2 className="mr-2 size-4" />
          Re-tester avec ces paramètres
        </Button>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {METRICS.map((metric) => (
          <Card key={metric.id} data-testid={`metric-${metric.id}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <BarChart3 className="size-4 text-muted-foreground" />
                {metric.label}
              </CardTitle>
              {metric.tooltip ? (
                <Badge
                  title={metric.tooltip}
                  variant="outline"
                >
                  ?
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">
                {metric.formatter(artifact.metrics[metric.id])}
              </p>
              <p className="text-muted-foreground text-xs">
                {metric.id === "winRate"
                  ? `${artifact.metrics.trades} trades` 
                  : "Synthèse calculée sur l'échantillon backtesté."}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section>
        <h4 className="font-semibold text-base">Courbe d'équité</h4>
        <div className="mt-2 rounded-lg border bg-muted/20 p-4">
          {equityPolyline ? (
            <svg
              aria-label="Évolution de l'équité"
              className="h-48 w-full"
              preserveAspectRatio="none"
              role="img"
              viewBox="0 0 100 100"
            >
              <polyline
                fill="none"
                points={equityPolyline}
                stroke="var(--primary)"
                strokeWidth="2"
              />
            </svg>
          ) : (
            <p className="text-muted-foreground text-sm">
              Aucun trade exécuté – la stratégie est restée en cash sur la période.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-base">Journal des trades</h4>
          <Badge variant="secondary">{artifact.trades.length} positions</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs uppercase">
                <th className="px-3 py-2">Entrée</th>
                <th className="px-3 py-2">Sortie</th>
                <th className="px-3 py-2">Prix entrée</th>
                <th className="px-3 py-2">Prix sortie</th>
                <th className="px-3 py-2">Quantité</th>
                <th className="px-3 py-2">PnL net</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTrades.length > 0 ? (
                paginatedTrades.map((trade, index) => (
                  <tr key={`${trade.entryTimestamp}-${index}`} className="border-t">
                    <td className="px-3 py-2">{formatDate(trade.entryTimestamp)}</td>
                    <td className="px-3 py-2">{formatDate(trade.exitTimestamp)}</td>
                    <td className="px-3 py-2">{formatCurrency(trade.entryPrice)}</td>
                    <td className="px-3 py-2">{formatCurrency(trade.exitPrice)}</td>
                    <td className="px-3 py-2">{trade.quantity}</td>
                    <td
                      className={trade.netPnl >= 0 ? "px-3 py-2 text-green-600" : "px-3 py-2 text-red-600"}
                    >
                      {formatCurrency(trade.netPnl)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-8 text-center" colSpan={6}>
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <AlertCircle className="size-5" />
                      Aucun trade n'a été simulé sur cette période.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((index) => Math.max(index - 1, 0))}
            size="sm"
            type="button"
            variant="ghost"
          >
            Précédent
          </Button>
          <span className="text-muted-foreground text-xs">
            Page {pageIndex + 1} / {pageCount}
          </span>
          <Button
            disabled={pageIndex >= pageCount - 1}
            onClick={() => setPageIndex((index) => Math.min(index + 1, pageCount - 1))}
            size="sm"
            type="button"
            variant="ghost"
          >
            Suivant
          </Button>
        </div>
      </section>

      {artifact.commentary ? (
        <section className="rounded-lg border bg-muted/10 p-4 text-sm">
          {artifact.commentary}
        </section>
      ) : null}
    </div>
  );
}
