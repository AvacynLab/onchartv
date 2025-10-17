import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { asset } from "./schema";
import { runMigrate } from "./migrate";
import {
  FINANCE_ASSET_CATALOG,
  type FinanceAssetMetadata,
} from "@/lib/finance/catalog";
import type { FinanceSymbol } from "@/lib/finance/types";
import { logError, logWarning } from "../logging";

/**
 * Canonical set of assets inserted during local development and CI.
 *
 * Keeping the seed data deterministic ensures offline tests and preview builds
 * have access to representative instruments without calling external market
 * providers.
 */
const SEED_ASSETS: ReadonlyArray<FinanceAssetMetadata> =
  Object.values(FINANCE_ASSET_CATALOG).sort((left, right) =>
    left.symbol.localeCompare(right.symbol)
  );

/** Symbols that must always be present in the deterministic seed catalogue. */
const REQUIRED_SEED_SYMBOLS: ReadonlyArray<FinanceSymbol> = [
  "AAPL",
  "NVDA",
  "BTCUSD",
  "EURUSD",
];

/**
 * Validates the offline catalogue before seeding so the database fixtures stay
 * aligned with the Playwright mocks (`AAPL`, `NVDA`, `BTCUSD`, `EURUSD`).
 */
function assertRequiredSeedCoverage(
  catalogue: ReadonlyArray<FinanceAssetMetadata>
): void {
  const missingSymbols = REQUIRED_SEED_SYMBOLS.filter(
    (requiredSymbol) =>
      !catalogue.some((entry) => entry.symbol === requiredSymbol)
  );

  if (missingSymbols.length > 0) {
    throw new Error(
      `Missing required finance seed asset(s): ${missingSymbols.join(", ")}`
    );
  }
}

const normaliseSymbol = (value: string) => value.trim().toUpperCase();
const normaliseExchange = (value: string) => value.trim().toUpperCase();
const normaliseCurrency = (value: string) => value.trim().toUpperCase();

/**
 * Seeds the Postgres database with deterministic finance fixtures.
 */
export async function seedDatabase(): Promise<void> {
  if (!process.env.POSTGRES_URL) {
    logWarning(
      "db:seed",
      "POSTGRES_URL is undefined – skipping finance seed execution."
    );
    return;
  }

  assertRequiredSeedCoverage(SEED_ASSETS);

  // Ensure the latest schema is present before attempting to seed finance
  // fixtures. GitHub Actions (and other CI pipelines) execute `db:seed`
  // immediately after provisioning a fresh Postgres instance; if migrations
  // have not run yet this would previously fail with `relation "Asset" does
  // not exist`. Running the migrator here is idempotent and guarantees the
  // catalogue table exists even when engineers invoke `pnpm db:seed`
  // directly.
  await runMigrate(process.env);

  const client = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(client);

  try {
    await db.transaction(async (tx) => {
      for (const entry of SEED_ASSETS) {
        const symbol = normaliseSymbol(entry.symbol);
        const exchange = normaliseExchange(entry.exchange);
        const currency = normaliseCurrency(entry.currency);

        await tx
          .insert(asset)
          .values({
            symbol,
            exchange,
            type: entry.type,
            name: entry.name,
            currency,
          })
          .onConflictDoUpdate({
            target: [asset.symbol, asset.exchange],
            set: {
              type: entry.type,
              name: entry.name,
              currency,
            },
          });
      }
    });

    console.info(
      `[db:seed] Inserted ${SEED_ASSETS.length} finance assets into the catalogue.`
    );
  } catch (error) {
    logError("db:seed", error, {
      message: "Failed to seed finance assets",
    });
    throw error;
  } finally {
    await client.end({ timeout: 5 }).catch((closeError) => {
      logWarning("db:seed", "Failed to close Postgres connection", {
        error: closeError,
      });
    });
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]!).href;

if (invokedDirectly) {
  seedDatabase().catch((error) => {
    logError("db:seed", error, { message: "Seed script failed" });
    process.exitCode = 1;
  });
}
