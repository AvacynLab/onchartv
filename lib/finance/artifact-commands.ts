import type {
  FinanceBacktestArtifact,
  FinanceChartArtifact,
} from "@/lib/finance/types";

/**
 * Build a deterministic `/backtest` slash command from an existing artefact so
 * users can quickly re-run the scenario with the chat composer. Unsupported
 * strategies return `null`, allowing callers to gracefully fall back to manual
 * prompts.
 */
export function buildBacktestSlashCommand(
  artifact: FinanceBacktestArtifact
): string | null {
  if (artifact.strategy.type !== "sma-crossover") {
    return null;
  }

  const { fastPeriod, slowPeriod } = artifact.strategy.params;
  return [
    "/backtest",
    artifact.symbol,
    artifact.timeframe,
    artifact.period.from,
    artifact.period.to,
    String(fastPeriod),
    String(slowPeriod),
  ].join(" ");
}

/** Format a UNIX timestamp (seconds) into an ISO date used inside prompts. */
function formatDateFromTimestamp(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString().split("T")[0] ?? "";
}

/**
 * Produce a natural-language follow-up prompt that asks the model to explain a
 * specific candle displayed within a finance chart artefact.
 */
export function buildExplainCandlePrompt(
  chart: FinanceChartArtifact,
  timestamp: number
): string {
  const isoDate = formatDateFromTimestamp(timestamp);
  const overlayDetails = chart.overlays.length
    ? `Include context from overlays such as ${chart.overlays
        .map((overlay) => `${overlay.type.toUpperCase()}(${overlay.length})`)
        .join(", ")}.`
    : "If no overlays are active, focus on price action, support/resistance, and volume.";

  return [
    `Explain the ${chart.symbol} candle that closed on ${isoDate} on the ${chart.timeframe} timeframe using the existing finance.chart artefact.`,
    `Use the displayed range (${chart.range.from} → ${chart.range.to}) for broader context and reference any detected patterns when relevant.`,
    overlayDetails,
    "Detail potential catalysts, quantify the move where possible, and reiterate that the analysis is educational rather than investment advice.",
  ].join(" ");
}
