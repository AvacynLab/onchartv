import { FINANCE_SYMBOLS } from "@/lib/finance/mock-data";
import type { FinanceSymbol } from "@/lib/finance/mock-data";

/**
 * Supported finance chat timeframes. We expose a small whitelist even though the
 * offline adapter currently ships with daily candles so the parsing logic
 * remains forward-compatible once additional intervals are unlocked.
 */
const SUPPORTED_TIMEFRAMES = new Set([
  "1D",
  "1W",
  "1M",
  "4H",
  "1H",
]);

const FINANCE_SYMBOL_SET = new Set(FINANCE_SYMBOLS);

function isFinanceSymbol(candidate: string | undefined): candidate is FinanceSymbol {
  if (!candidate) {
    return false;
  }

  // The catalogue is tiny, so leveraging the Set keeps lookups constant time.
  return FINANCE_SYMBOL_SET.has(candidate as FinanceSymbol);
}

export type SlashCommand =
  | {
      readonly kind: "finance.chart";
      readonly symbol: string;
      readonly timeframe: string;
      readonly overlayHint?: string;
    }
  | {
      readonly kind: "finance.backtest";
      readonly symbol: string;
      readonly timeframe: string;
      readonly range: { readonly from: string; readonly to: string };
      readonly fastPeriod: number;
      readonly slowPeriod: number;
    };

export interface SlashCommandResolution {
  readonly prompt: string;
  readonly kind: SlashCommand["kind"];
}

const ISO_DATE_PATTERN = /\d{4}-\d{2}-\d{2}/;

function isValidDate(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function isTimeframe(candidate: string | undefined): candidate is string {
  if (!candidate) {
    return false;
  }

  return SUPPORTED_TIMEFRAMES.has(candidate.toUpperCase());
}

function extractChartCommand(tokens: string[]): SlashCommand | null {
  const symbol = tokens.shift()?.toUpperCase();

  if (!isFinanceSymbol(symbol)) {
    return null;
  }

  const maybeTimeframe = tokens[0]?.toUpperCase();
  const timeframe = isTimeframe(maybeTimeframe) ? tokens.shift()!.toUpperCase() : "1D";
  const overlayHint = tokens.length > 0 ? tokens.join(" ") : undefined;

  return {
    kind: "finance.chart",
    symbol,
    timeframe,
    overlayHint,
  };
}

function parseNumberToken(token: string | undefined): number | undefined {
  if (!token) {
    return undefined;
  }

  const parsed = Number.parseInt(token, 10);

  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

function extractBacktestCommand(tokens: string[]): SlashCommand | null {
  const symbol = tokens.shift()?.toUpperCase();

  if (!isFinanceSymbol(symbol)) {
    return null;
  }

  const maybeTimeframe = tokens[0]?.toUpperCase();
  const timeframe = isTimeframe(maybeTimeframe) ? tokens.shift()!.toUpperCase() : "1D";

  const from = tokens.shift();
  const to = tokens.shift();

  if (!isValidDate(from) || !isValidDate(to)) {
    return null;
  }

  const fast = parseNumberToken(tokens.shift());
  const slow = parseNumberToken(tokens.shift());

  const fastPeriod = fast && fast >= 2 ? fast : 50;
  const slowPeriod = slow && slow > fastPeriod ? slow : 200;

  return {
    kind: "finance.backtest",
    symbol,
    timeframe,
    range: { from, to },
    fastPeriod,
    slowPeriod,
  };
}

export function parseSlashCommand(rawInput: string): SlashCommand | null {
  const trimmed = rawInput.trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [, ...rest] = trimmed.split(/\s+/);
  const command = trimmed.slice(1, trimmed.indexOf(" ") > 0 ? trimmed.indexOf(" ") : undefined).toLowerCase();
  const tokens = rest.map((token) => token.trim()).filter(Boolean);

  switch (command) {
    case "chart":
      return extractChartCommand(tokens);
    case "backtest":
      return extractBacktestCommand(tokens);
    default:
      return null;
  }
}

export function resolveSlashCommand(rawInput: string): SlashCommandResolution | null {
  const command = parseSlashCommand(rawInput);

  if (!command) {
    return null;
  }

  if (command.kind === "finance.chart") {
    const { symbol, timeframe, overlayHint } = command;
    const overlaySentence = overlayHint
      ? `Incorporate the following overlay or annotation request: ${overlayHint}.`
      : "Highlight any notable trend changes, support/resistance interactions, or candlestick patterns you detect.";

    const prompt = [
      `Create a finance.chart artifact for ${symbol} on the ${timeframe} timeframe using the offline market dataset.`,
      overlaySentence,
      "Explain what the chart shows in plain language, reference indicator crossovers when relevant, and remind the user that the output is educational rather than investment advice.",
    ].join(" ");

    return {
      kind: command.kind,
      prompt,
    };
  }

  const { symbol, timeframe, range, fastPeriod, slowPeriod } = command;
  const prompt = [
    `Run a finance.backtest artifact request for ${symbol} using the SMA crossover strategy with a fast window of ${fastPeriod} candles and a slow window of ${slowPeriod} candles on the ${timeframe} timeframe.`,
    `Constrain the analysis to the period starting ${range.from} and ending ${range.to}.`,
    "Return standard metrics (CAGR, total return, max drawdown, win rate, sharpe, profit factor) alongside the equity curve and a chronological list of trades.",
    "Summarise the performance drivers, call out risk considerations, and include a non-advisory disclaimer in the narrative.",
  ].join(" ");

  return {
    kind: command.kind,
    prompt,
  };
}
