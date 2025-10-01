"use client";

import React from "react";
import type {
  FinanceBacktestArtifact,
  FinanceChartAnnotationsArtifact,
  FinanceArtifact,
} from "@/lib/finance/types";
import { BacktestReportArtifact } from "./finance/backtest-report-artifact";
import { ChartAnnotationsPanel } from "./finance/chart-annotations-panel";
import { FinanceChartArtifact as FinanceChartView } from "./finance/finance-chart-artifact";
import { FundamentalsCard } from "./finance/fundamentals-card";
import { NewsList } from "./finance/news-list";
import { ScreenResultsCard } from "./finance/screen-results-card";

export interface ArtifactRendererProps {
  readonly artifact: FinanceArtifact;
  readonly onExplainCandle?: (params: {
    readonly timestamp: number;
    readonly symbol: string;
  }) => void;
  readonly chartAnnotations?: FinanceChartAnnotationsArtifact | null;
  readonly onRetest?: (artifact: FinanceBacktestArtifact) => void;
}

/**
 * Centralised dispatcher mapping a finance artefact payload to the dedicated UI
 * component. Keeping a single entry point avoids duplicating switch/case logic
 * across the chat interface and future dashboards.
 */
export function ArtifactRenderer({
  artifact,
  onExplainCandle,
  chartAnnotations,
  onRetest,
}: ArtifactRendererProps) {
  /**
   * Guard against malformed payloads. Even though the type signature narrows
   * the artefact union, runtime data coming from the AI assistant can still be
   * ill-formed, so we present a helpful alert instead of crashing the UI.
   */
  if (!artifact || typeof artifact !== "object" || !("type" in artifact)) {
    console.error("[ArtifactRenderer] unsupported artefact payload", artifact);
    return (
      <div
        className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        data-testid="artifact-renderer-error"
        role="alert"
      >
        Contenu indisponible : le format de l’artefact fourni est invalide.
      </div>
    );
  }

  /**
   * Preserve the artefact label upfront so the default branch can surface a
   * human-readable message without trying to access `type` on a `never`
   * discriminant (which causes the build failure observed in CI).
   */
  const fallbackTypeLabel = artifact.type;

  switch (artifact.type) {
    case "finance.chart":
      return (
        <FinanceChartView
          annotations={chartAnnotations}
          artifact={artifact}
          onExplainCandle={onExplainCandle}
        />
      );
    case "finance.chart.annotations":
      return <ChartAnnotationsPanel annotations={artifact} />;
    case "finance.backtest":
      return (
        <BacktestReportArtifact artifact={artifact} onRetest={onRetest} />
      );
    case "finance.fundamentals":
      return <FundamentalsCard artifact={artifact} />;
    case "finance.news":
      return <NewsList artifact={artifact} />;
    case "finance.screen":
      return <ScreenResultsCard artifact={artifact} />;
    default:
      console.error("[ArtifactRenderer] unknown artefact type", artifact);
      return (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          data-testid="artifact-renderer-error"
          role="alert"
        >
          Contenu indisponible : l’artefact « {fallbackTypeLabel} » n’est pas pris en charge.
        </div>
      );
  }
}
