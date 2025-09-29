import assert from "node:assert/strict";
import { describe, it } from "node:test";

// These tests exercise the migration skip helper so contributors understand how
// to opt out of database migrations when the build runs in an offline setting.
import { shouldSkipMigrations } from "../../lib/db/migrate";

describe("shouldSkipMigrations", () => {
  it("skips when the SKIP_DB_MIGRATIONS flag is set", () => {
    const result = shouldSkipMigrations({
      SKIP_DB_MIGRATIONS: "true",
    } as NodeJS.ProcessEnv);

    assert.equal(result.skip, true);
    assert.match(result.reason ?? "", /flag is enabled/);
  });

  it("does not skip when the flag is absent", () => {
    const result = shouldSkipMigrations({
      POSTGRES_URL: "postgres://user:pass@localhost:5432/db",
    } as NodeJS.ProcessEnv);

    assert.equal(result.skip, false);
    assert.equal(result.reason, undefined);
  });

  it("handles alternative truthy values", () => {
    const result = shouldSkipMigrations({
      SKIP_DB_MIGRATIONS: "1",
    } as NodeJS.ProcessEnv);

    assert.equal(result.skip, true);
  });
});
