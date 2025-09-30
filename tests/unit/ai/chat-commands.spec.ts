import { describe, expect, it } from "vitest";

import {
  parseSlashCommand,
  resolveSlashCommand,
  type SlashCommand,
} from "@/lib/ai/chat-commands";

const BASE_CHART_COMMAND: SlashCommand = {
  kind: "finance.chart",
  symbol: "BTCUSD",
  timeframe: "1D",
};

const BASE_BACKTEST_COMMAND: SlashCommand = {
  kind: "finance.backtest",
  symbol: "AAPL",
  timeframe: "1D",
  range: { from: "2018-01-01", to: "2020-12-31" },
  fastPeriod: 50,
  slowPeriod: 200,
};

describe("finance slash commands", () => {
  it("parses a basic chart shortcut", () => {
    expect(parseSlashCommand("/chart btcusd 1d")).toEqual(BASE_CHART_COMMAND);
  });

  it("defaults to the daily timeframe when omitted", () => {
    expect(parseSlashCommand("/chart aapl")).toEqual({
      ...BASE_CHART_COMMAND,
      symbol: "AAPL",
    });
  });

  it("injects overlay hints into the resolved prompt", () => {
    const resolution = resolveSlashCommand("/chart nvda 1d include rsi please");

    expect(resolution).not.toBeNull();
    expect(resolution?.kind).toBe("finance.chart");
    expect(resolution?.prompt).toContain("include rsi please");
  });

  it("rejects unknown symbols", () => {
    expect(parseSlashCommand("/chart tsla" as const)).toBeNull();
  });

  it("parses the backtest shortcut with explicit windows", () => {
    expect(
      parseSlashCommand("/backtest aapl 2018-01-01 2020-12-31 10 30")
    ).toEqual({
      ...BASE_BACKTEST_COMMAND,
      fastPeriod: 10,
      slowPeriod: 30,
    });
  });

  it("falls back to default moving average windows when omitted", () => {
    expect(parseSlashCommand("/backtest aapl 2018-01-01 2020-12-31")).toEqual(
      BASE_BACKTEST_COMMAND
    );
  });

  it("creates a descriptive prompt for the backtest command", () => {
    const resolution = resolveSlashCommand(
      "/backtest aapl 2018-01-01 2020-12-31 10 30"
    );

    expect(resolution).not.toBeNull();
    expect(resolution?.prompt).toContain("finance.backtest artifact request");
    expect(resolution?.prompt).toContain("2018-01-01");
    expect(resolution?.prompt).toContain("fast window of 10");
  });

  it("ignores unsupported commands", () => {
    expect(resolveSlashCommand("/weather sf" as const)).toBeNull();
  });
});
