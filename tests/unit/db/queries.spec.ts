import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

process.env.PLAYWRIGHT = "1";

import type {
  CreateBacktestRunInput,
  CreateStrategyInput,
} from "../../../lib/db/queries";
import type {
  BacktestMetrics,
  BacktestTrade,
  EquityCurvePoint,
} from "../../../lib/finance/types";

const USER_ID = "user-123";

let queries: typeof import("../../../lib/db/queries");

beforeAll(async () => {
  queries = await import("../../../lib/db/queries");
});

beforeEach(() => {
  queries.__resetInMemoryDbForTests();
});

describe("finance queries", () => {
  it("normalises assets on upsert and fetch", async () => {
    const created = await queries.upsertAsset({
      symbol: "aapl",
      exchange: "nasdaq",
      type: "equity",
      name: "Apple",
      currency: "usd",
    });

    expect(created.symbol).toBe("AAPL");
    expect(created.exchange).toBe("NASDAQ");
    expect(created.currency).toBe("USD");

    const fetched = await queries.getAssetBySymbol({
      symbol: "AAPL",
      exchange: "NASDAQ",
    });

    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);

    const updated = await queries.upsertAsset({
      symbol: "AAPL",
      exchange: "NASDAQ",
      type: "equity",
      name: "Apple Inc.",
      currency: "USD",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Apple Inc.");
  });

  it("persists backtests and orders them by recency", async () => {
    const asset = await queries.upsertAsset({
      symbol: "BTCUSD",
      exchange: "COINBASE",
      type: "crypto",
      name: "Bitcoin / US Dollar",
      currency: "USD",
    });

    const strategyInput: CreateStrategyInput = {
      userId: USER_ID,
      name: "SMA Cross",
      description: "50/200 crossover",
    };
    const strategy = await queries.createStrategy(strategyInput);
    const version = await queries.createStrategyVersion({
      strategyId: strategy.id,
      params: { fast: 50, slow: 200 },
    });

    const metrics: BacktestMetrics = {
      totalReturn: 0.18,
      cagr: 0.09,
      maxDrawdown: 0.12,
      winRate: 0.55,
      averageWin: 120,
      averageLoss: 80,
      sharpe: 1.1,
      profitFactor: 1.8,
      trades: 24,
    };
    const trades: BacktestTrade[] = [
      {
        entryTimestamp: 1_700_000_000,
        entryPrice: 40_000,
        exitTimestamp: 1_700_086_400,
        exitPrice: 42_000,
        quantity: 1,
        grossPnl: 2_000,
        netPnl: 1_980,
      },
    ];
    const equityCurve: EquityCurvePoint[] = [
      { timestamp: 1_700_000_000, equity: 10_000 },
      { timestamp: 1_700_086_400, equity: 11_980 },
    ];

    const baseInput: Omit<CreateBacktestRunInput, "metrics" | "trades" | "equityCurve"> = {
      strategyVersionId: version.id,
      assetId: asset.id,
      timeframe: "1D",
      periodStart: new Date("2020-01-01T00:00:00.000Z"),
      periodEnd: new Date("2020-12-31T00:00:00.000Z"),
    };

    const firstRun = await queries.createBacktestRun({
      ...baseInput,
      metrics,
      trades,
      equityCurve,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const secondRun = await queries.createBacktestRun({
      ...baseInput,
      periodEnd: new Date("2021-12-31T00:00:00.000Z"),
      metrics: { ...metrics, totalReturn: 0.32, cagr: 0.15, trades: 48 },
      trades: [...trades, { ...trades[0], netPnl: 2_400, exitTimestamp: 1_700_172_800 }],
      equityCurve: [
        ...equityCurve,
        { timestamp: 1_700_172_800, equity: 13_500 },
      ],
    });

    const runs = await queries.listBacktestsByStrategy({
      strategyId: strategy.id,
    });

    expect(runs).toHaveLength(2);
    expect(runs[0]?.id).toBe(secondRun.id);
    expect(runs[1]?.id).toBe(firstRun.id);

    const limitedRuns = await queries.listBacktestsByStrategy({
      strategyId: strategy.id,
      limit: 1,
    });

    expect(limitedRuns).toHaveLength(1);
    expect(limitedRuns[0]?.id).toBe(secondRun.id);
  });

  it("upserts and retrieves user finance preferences", async () => {
    const initial = await queries.upsertFinancePreferences({
      userId: USER_ID,
      markets: ["CRYPTO", "US_EQUITIES"],
      defaultIndicators: [
        { type: "sma", length: 21 },
        { type: "rsi", period: 14 },
      ],
      explanationLevel: "detailed",
      showNews: false,
    });

    expect(initial.userId).toBe(USER_ID);
    expect(initial.explanationLevel).toBe("detailed");
    expect(initial.showNews).toBe(false);
    expect(initial.markets).toEqual(["US_EQUITIES", "CRYPTO"]);

    const fetched = await queries.getFinancePreferencesByUserId({
      userId: USER_ID,
    });

    expect(fetched).not.toBeNull();
    expect(fetched?.markets).toEqual(["US_EQUITIES", "CRYPTO"]);
    expect(fetched?.createdAt.getTime()).toBe(initial.createdAt.getTime());

    const updated = await queries.upsertFinancePreferences({
      userId: USER_ID,
      markets: ["FOREX", "US_EQUITIES"],
      defaultIndicators: [
        { type: "ema", length: 34 },
        { type: "bollinger", length: 20, standardDeviations: 2 },
      ],
      explanationLevel: "concise",
      showNews: true,
    });

    expect(updated.explanationLevel).toBe("concise");
    expect(updated.markets).toEqual(["US_EQUITIES", "FOREX"]);
    expect(updated.createdAt.getTime()).toBe(initial.createdAt.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      initial.updatedAt.getTime()
    );
    expect(updated.indicators).toHaveLength(2);
  });
});
