import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({
  path: ".env.local",
});

/**
 * Determines whether the migration script should bail out early.
 *
 * We allow engineers to skip migrations when working offline or in
 * hermetic CI environments by exporting `SKIP_DB_MIGRATIONS`. The helper
 * returns both the skip decision and a short description so callers can log
 * why migrations were avoided.
 */
export const shouldSkipMigrations = (env: NodeJS.ProcessEnv = process.env) => {
  const flag = env.SKIP_DB_MIGRATIONS?.toLowerCase();

  if (flag && ["1", "true", "yes"].includes(flag)) {
    return {
      reason: "SKIP_DB_MIGRATIONS flag is enabled",
      skip: true,
    } as const;
  }

  return {
    reason: undefined,
    skip: false,
  } as const;
};

/**
 * Executes the Drizzle migration pipeline against the configured Postgres
 * database. The function intentionally accepts a process-env bag for tests
 * so we can exercise the skip-path behaviour without mutating global state.
 */
export const runMigrate = async (
  env: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  const { skip, reason } = shouldSkipMigrations(env);

  if (skip) {
    const message = reason ? `⚠️  Skipping database migrations: ${reason}` : "⚠️  Skipping database migrations";
    console.log(message);
    return;
  }

  if (!env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not defined");
  }

  const connection = postgres(env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  console.log("⏳ Running migrations...");

  const start = Date.now();

  try {
    await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  } finally {
    // Ensure the connection is closed so `pnpm build` can exit cleanly even
    // when the process is bundled into larger scripts.
    await connection.end({ timeout: 5 });
  }

  const end = Date.now();

  console.log("✅ Migrations completed in", end - start, "ms");
};

if (import.meta.main) {
  runMigrate().then(
    () => {
      process.exit(0);
    },
    (err) => {
      console.error("❌ Migration failed");
      console.error(err);
      process.exit(1);
    }
  );
}
