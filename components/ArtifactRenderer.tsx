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
      return null;
  }
}
