import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = join(
  process.cwd(),
  "lib/db/migrations/0008_resilient_finance_scaffold.sql"
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, "utf8");
const BASELINE_SCHEMA_SQL = `
CREATE TABLE "User" (
  id uuid PRIMARY KEY
);

CREATE TABLE "Message_v2" (
  id uuid PRIMARY KEY,
  chatId uuid,
  role varchar NOT NULL,
  parts json NOT NULL,
  attachments json NOT NULL,
  createdAt timestamp NOT NULL
);
`;

describe("finance schema migration", () => {
  it("applies cleanly and exposes all finance tables", async () => {
    const db = new PGlite();

    try {
      await db.exec(BASELINE_SCHEMA_SQL);
      await db.exec(MIGRATION_SQL);

      const tableNames = [
        "Asset",
        "Watchlist",
        "WatchlistItem",
        "Strategy",
        "StrategyVersion",
        "BacktestRun",
        "IndicatorConfig",
        "NewsItemCache",
      ];

      for (const name of tableNames) {
        const result = await db.query<{ exists: string | null }>(
          `SELECT to_regclass('public."${name}"') AS exists;`
        );

        const normalised = result.rows[0]?.exists?.replace(/"/g, "");
        expect(normalised).toBe(name);
      }

      const columnResult = await db.query<{
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'Message_v2' AND column_name = 'artifacts';`
      );

      expect(columnResult.rows[0]?.is_nullable).toBe("NO");
      expect(columnResult.rows[0]?.column_default).toBe("'[]'::jsonb");
    } finally {
      await db.close();
    }
  });

  it("rolls back without leaving side effects", async () => {
    const db = new PGlite();

    try {
      await db.exec(BASELINE_SCHEMA_SQL);
      const transactionalSql = `BEGIN;\n${MIGRATION_SQL}\nROLLBACK;`;

      await db.exec(transactionalSql);

      const result = await db.query<{ exists: string | null }>(
        `SELECT to_regclass('public."Asset"') AS exists;`
      );

      expect(result.rows[0]?.exists).toBeNull();
    } finally {
      await db.close();
    }
  });
});
