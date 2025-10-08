"use client";

import React from "react";
import { Building2, Factory, LineChart, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { FinanceFundamentalsArtifact } from "@/lib/finance/types";

type Snapshot = FinanceFundamentalsArtifact["snapshot"];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Normalise a possibly-nullish numeric value so the UI never attempts to format
 * `undefined`/`NaN`. Returning `null` keeps downstream helpers consistent.
 */
const normaliseMetric = (value: unknown): number | null =>
  isFiniteNumber(value) ? value : null;

const formatCurrency = (value: unknown) => {
  const metric = normaliseMetric(value);
  if (metric === null || metric === 0) {
    return "—";
  }

  return `${(metric / 1_000_000_000).toFixed(1)} Md$`;
};

const formatPercent = (value: unknown) => {
  const metric = normaliseMetric(value);
  if (metric === null || metric === 0) {
    return "—";
  }

  return `${(metric * 100).toFixed(1)}%`;
};

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
  const symbol =
    typeof artifact?.symbol === "string" && artifact.symbol.trim().length > 0
      ? artifact.symbol
      : "Instrument inconnu";

  const snapshot: Partial<Snapshot> =
    artifact && typeof artifact === "object" && artifact.snapshot
      ? (artifact.snapshot as Snapshot)
      : {};

  const highlights = Array.isArray(artifact.highlights)
    ? artifact.highlights
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item): item is string => item.length > 0)
    : [];

  /**
   * Trim and validate the caution message so artefacts with placeholder strings
   * (e.g. " ") do not render a misleading banner.
   */
  const caution = (() => {
    if (typeof artifact.caution !== "string") {
      return null;
    }

    const trimmed = artifact.caution.trim();
    return trimmed.length > 0 ? trimmed : null;
  })();

  /**
   * Render-time metadata describing each tile in the fundamentals grid. The
   * configuration keeps the JSX concise while documenting how every ratio is
   * formatted and explained to the user.
   */
  const metrics: Array<{
    readonly key: keyof Snapshot;
    readonly label: string;
    readonly icon: React.ComponentType<{ className?: string }>;
    readonly description: string;
    readonly formatter: (value: unknown) => string;
  }> = [
    {
      key: "marketCap",
      label: "Capitalisation",
      icon: Building2,
      description: METRIC_DESCRIPTIONS.marketCap,
      formatter: (value) =>
        isFiniteNumber(value)
          ? value.toLocaleString(undefined, {
              notation: "compact",
              maximumFractionDigits: 1,
            })
          : "—",
    },
    {
      key: "peRatio",
      label: "PE ratio",
      icon: LineChart,
      description: METRIC_DESCRIPTIONS.peRatio,
      formatter: (value) =>
        isFiniteNumber(value) && value !== 0 ? value.toFixed(1) : "—",
    },
    {
      key: "dividendYield",
      label: "Dividende",
      icon: LineChart,
      description: METRIC_DESCRIPTIONS.dividendYield,
      formatter: formatPercent,
    },
    {
      key: "revenueTtm",
      label: "Revenus TTM",
      icon: Factory,
      description: METRIC_DESCRIPTIONS.revenueTtm,
      formatter: formatCurrency,
    },
    {
      key: "grossMargin",
      label: "Marge brute",
      icon: LineChart,
      description: METRIC_DESCRIPTIONS.grossMargin,
      formatter: formatPercent,
    },
    {
      key: "netMargin",
      label: "Marge nette",
      icon: LineChart,
      description: METRIC_DESCRIPTIONS.netMargin,
      formatter: formatPercent,
    },
    {
      key: "debtToEquity",
      label: "Dette / Capitaux propres",
      icon: ShieldAlert,
      description: METRIC_DESCRIPTIONS.debtToEquity,
      formatter: (value) =>
        isFiniteNumber(value) && value !== 0 ? value.toFixed(2) : "—",
    },
  ];

  return (
    <div className="space-y-4" data-testid="finance-fundamentals-artifact">
      <header className="flex flex-col gap-1">
        <h3 className="font-semibold text-lg">Fondamentaux — {symbol}</h3>
        <p className="text-muted-foreground text-sm">
          Ratios clés extraits du catalogue hermétique.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const value = snapshot[metric.key];

          return (
            <div
              className={`rounded-lg border p-4 ${
                metric.key === "debtToEquity" ? "md:col-span-2" : ""
              }`}
              key={metric.key as string}
            >
              <div className="flex items-center gap-2">
                <Icon className="size-5 text-muted-foreground" />
                <span className="font-medium">{metric.label}</span>
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {metric.formatter(value)}
              </p>
              <p className="text-muted-foreground text-xs">{metric.description}</p>
            </div>
          );
        })}
      </div>

      {highlights.length > 0 ? (
        <div className="space-y-2">
          <h4 className="font-semibold text-base">Points saillants</h4>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {caution ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>{caution}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">Catalogue hermétique</Badge>
        <Badge variant="outline">Dernière mise à jour simulée : 2025</Badge>
      </div>
    </div>
  );
}
