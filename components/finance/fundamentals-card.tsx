"use client";

import React from "react";
import { Building2, Factory, LineChart, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { FinanceFundamentalsArtifact } from "@/lib/finance/types";

const formatCurrency = (value: number) =>
  value === 0
    ? "—"
    : `${(value / 1_000_000_000).toFixed(1)} Md$`;

const formatPercent = (value: number) =>
  value === 0 ? "—" : `${(value * 100).toFixed(1)}%`;

const METRIC_DESCRIPTIONS: Record<string, string> = {
  marketCap: "Capitalisation boursière estimée.",
  peRatio: "Multiple cours/bénéfice lissé sur 12 mois.",
  dividendYield: "Rendement annualisé distribué aux actionnaires.",
  revenueTtm: "Chiffre d'affaires sur douze mois glissants.",
  grossMargin: "Marge brute: capacité à convertir les ventes en marge.",
  netMargin: "Marge nette après charges.",
  debtToEquity: "Structure du capital (dette / capitaux propres).",
};

/**
 * Compact fundamentals renderer showing the synthetic ratios bundled in the
 * artefact. The card emphasises interpretability by pairing each metric with a
 * short description and meaningful iconography.
 */
export function FundamentalsCard({
  artifact,
}: {
  readonly artifact: FinanceFundamentalsArtifact;
}) {
  const snapshot = artifact.snapshot;

  return (
    <div className="space-y-4" data-testid="finance-fundamentals-artifact">
      <header className="flex flex-col gap-1">
        <h3 className="font-semibold text-lg">Fondamentaux — {artifact.symbol}</h3>
        <p className="text-muted-foreground text-sm">
          Ratios clés extraits du catalogue hermétique.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <Building2 className="size-5 text-muted-foreground" />
            <span className="font-medium">Capitalisation</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {snapshot.marketCap === 0
              ? "—"
              : snapshot.marketCap.toLocaleString(undefined, {
                  notation: "compact",
                  maximumFractionDigits: 1,
                })}
          </p>
          <p className="text-muted-foreground text-xs">
            {METRIC_DESCRIPTIONS.marketCap}
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <LineChart className="size-5 text-muted-foreground" />
            <span className="font-medium">PE ratio</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {snapshot.peRatio === 0 ? "—" : snapshot.peRatio.toFixed(1)}
          </p>
          <p className="text-muted-foreground text-xs">
            {METRIC_DESCRIPTIONS.peRatio}
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <LineChart className="size-5 text-muted-foreground" />
            <span className="font-medium">Dividende</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatPercent(snapshot.dividendYield)}
          </p>
          <p className="text-muted-foreground text-xs">
            {METRIC_DESCRIPTIONS.dividendYield}
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <Factory className="size-5 text-muted-foreground" />
            <span className="font-medium">Revenus TTM</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatCurrency(snapshot.revenueTtm)}
          </p>
          <p className="text-muted-foreground text-xs">
            {METRIC_DESCRIPTIONS.revenueTtm}
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <LineChart className="size-5 text-muted-foreground" />
            <span className="font-medium">Marge brute</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatPercent(snapshot.grossMargin)}
          </p>
          <p className="text-muted-foreground text-xs">
            {METRIC_DESCRIPTIONS.grossMargin}
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <LineChart className="size-5 text-muted-foreground" />
            <span className="font-medium">Marge nette</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatPercent(snapshot.netMargin)}
          </p>
          <p className="text-muted-foreground text-xs">
            {METRIC_DESCRIPTIONS.netMargin}
          </p>
        </div>

        <div className="rounded-lg border p-4 md:col-span-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-muted-foreground" />
            <span className="font-medium">Dette / Capitaux propres</span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {snapshot.debtToEquity === 0
              ? "—"
              : snapshot.debtToEquity.toFixed(2)}
          </p>
          <p className="text-muted-foreground text-xs">
            {METRIC_DESCRIPTIONS.debtToEquity}
          </p>
        </div>
      </div>

      {artifact.highlights.length > 0 ? (
        <div className="space-y-2">
          <h4 className="font-semibold text-base">Points saillants</h4>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {artifact.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {artifact.caution ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>{artifact.caution}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">Catalogue hermétique</Badge>
        <Badge variant="outline">Dernière mise à jour simulée : 2025</Badge>
      </div>
    </div>
  );
}
