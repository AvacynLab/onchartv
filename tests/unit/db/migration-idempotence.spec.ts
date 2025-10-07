import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Ensures every SQL migration can be executed multiple times without failing by
 * checking for `IF NOT EXISTS` guards on table/index creation and column
 * additions. This lightweight text-based verification keeps us honest without
 * spinning up a Postgres instance during unit tests.
 */
describe("database migrations", () => {
  const migrationsDir = path.join(process.cwd(), "lib", "db", "migrations");
  const migrationFiles = readdirSync(migrationsDir).filter((file) =>
    file.endsWith(".sql"),
  );

  for (const file of migrationFiles) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");

    it(`${file} guards CREATE TABLE statements`, () => {
      const createTableWithoutGuard = /CREATE TABLE\s+(?!IF NOT EXISTS)/gi;
      expect(createTableWithoutGuard.test(sql)).toBe(false);
    });

    it(`${file} guards CREATE INDEX statements`, () => {
      const createIndexWithoutGuard = /CREATE (?:UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/gi;
      expect(createIndexWithoutGuard.test(sql)).toBe(false);
    });

    it(`${file} guards ALTER TABLE ... ADD COLUMN statements`, () => {
      const addColumnWithoutGuard = /ALTER TABLE[\s\S]*?ADD COLUMN(?! IF NOT EXISTS)/gi;
      expect(addColumnWithoutGuard.test(sql)).toBe(false);
    });
  }
});
