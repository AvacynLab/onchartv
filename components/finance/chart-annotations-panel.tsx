"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import type { FinanceChartAnnotationsArtifact } from "@/lib/finance/types";

const formatPrice = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const formatDate = (timestamp: number) =>
  new Date(timestamp * 1_000).toISOString().split("T")[0];

/**
 * Small helper component rendering the annotations emitted by the finance chart
 * analysis tool. It can be reused both inside the candlestick viewer and when
 * annotations are streamed on their own.
 */
export function ChartAnnotationsPanel({
  annotations,
}: {
  readonly annotations: FinanceChartAnnotationsArtifact;
}) {
  return (
    <div className="space-y-3" data-testid="finance-chart-annotations">
      <div className="flex items-center gap-2">
        <h4 className="font-semibold text-base">Annotations techniques</h4>
        <Badge variant="outline">
          {annotations.patterns.length + annotations.levels.length}
        </Badge>
      </div>
      <div className="space-y-2 text-sm">
        {annotations.patterns.length > 0 ? (
          <div>
            <p className="font-medium">Motifs détectés</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {annotations.patterns.map((pattern) => (
                <li key={`${pattern.name}-${pattern.index}`}>
                  <span className="font-medium">{pattern.name}</span>
                  {": "}
                  {pattern.explanation}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {annotations.levels.length > 0 ? (
          <div>
            <p className="font-medium">Niveaux clés</p>
            <ul className="mt-1 space-y-1">
              {annotations.levels.map((level, index) => (
                <li
                  className="flex flex-wrap items-center gap-2"
                  key={`${level.type}-${level.price}-${index}`}
                >
                  <Badge
                    variant={level.type === "support" ? "secondary" : "default"}
                  >
                    {level.type === "support" ? "Support" : "Résistance"}
                  </Badge>
                  <span>{formatPrice(level.price)}</span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    •
                  </span>
                  <span>
                    {formatDate(level.from)} → {formatDate(level.to)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {annotations.patterns.length === 0 && annotations.levels.length === 0 ? (
          <p className="text-muted-foreground">
            Aucun motif notable détecté sur l'échantillon analysé.
          </p>
        ) : null}
      </div>
    </div>
  );
}
