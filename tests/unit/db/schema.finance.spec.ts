import { describe, expect, it } from "vitest";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  asset,
  backtestRun,
  strategyVersion,
} from "@/lib/db/schema";

/**
 * Maps Drizzle index metadata into a serialisable shape for assertions.
 */
const mapIndexes = (table: typeof asset | typeof backtestRun) => {
  const { indexes } = getTableConfig(table);

  return indexes.map((index) => ({
    name: index.config.name,
    columns: index.config.columns.map((column) => column.name),
    unique: Boolean(index.config.unique),
  }));
};

/**
 * Normalises foreign key metadata so we can assert cascade behaviours
 * without depending on Drizzle internals leaking through the public API.
 */
const mapForeignKeys = (
  table: typeof backtestRun | typeof strategyVersion
) => {
  const { foreignKeys } = getTableConfig(table);

  return foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();

    return {
      onDelete: foreignKey.onDelete,
      columns: reference.columns.flat().map((column) => column.name),
      foreignColumns: reference.foreignColumns
        .flat()
        .map((column) => column.name),
      foreignTable: getTableName(reference.foreignTable),
    };
  });
};

describe("finance database schema", () => {
  it("enforces unique symbol/exchange pairs on Asset", () => {
    const indexes = mapIndexes(asset);

    expect(indexes).toContainEqual({
      name: "Asset_symbol_exchange_unique",
      columns: ["symbol", "exchange"],
      unique: true,
    });
  });

  it("deduplicates backtest runs per strategy/timeframe window", () => {
    const indexes = mapIndexes(backtestRun);

    expect(indexes).toContainEqual({
      name: "BacktestRun_asset_timeframe_period_unique",
      columns: [
        "assetId",
        "timeframe",
        "periodStart",
        "strategyVersionId",
        "periodEnd",
      ],
      unique: true,
    });
  });

  it("cascades strategy deletions through strategy versions and backtests", () => {
    const versionForeignKeys = mapForeignKeys(strategyVersion);
    const runForeignKeys = mapForeignKeys(backtestRun);

    expect(versionForeignKeys).toContainEqual({
      onDelete: "cascade",
      columns: ["strategyId"],
      foreignColumns: ["id"],
      foreignTable: "Strategy",
    });

    expect(runForeignKeys).toContainEqual({
      onDelete: "cascade",
      columns: ["strategyVersionId"],
      foreignColumns: ["id"],
      foreignTable: "StrategyVersion",
    });
  });
});
