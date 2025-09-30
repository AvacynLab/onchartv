import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { asset } from "./schema";
import {
  FINANCE_ASSET_CATALOG,
  type FinanceAssetMetadata,
} from "@/lib/finance/catalog";

/**
 * Canonical set of assets inserted during local development and CI.
 *
 * Keeping the seed data deterministic ensures offline tests and preview builds
 * have access to representative instruments without calling external market
 * providers.
 */
const SEED_ASSETS: ReadonlyArray<FinanceAssetMetadata> =
  Object.values(FINANCE_ASSET_CATALOG);

const normaliseSymbol = (value: string) => value.trim().toUpperCase();
const normaliseExchange = (value: string) => value.trim().toUpperCase();
const normaliseCurrency = (value: string) => value.trim().toUpperCase();

/**
 * Seeds the Postgres database with deterministic finance fixtures.
 */
export async function seedDatabase(): Promise<void> {
  if (!process.env.POSTGRES_URL) {
    console.warn(
      "[db:seed] POSTGRES_URL is undefined – skipping finance seed execution."
    );
    return;
  }

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
    console.error("[db:seed] Failed to seed finance assets", error);
    throw error;
  } finally {
    await client.end({ timeout: 5 }).catch((closeError) => {
      console.warn("[db:seed] Failed to close Postgres connection", closeError);
    });
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]!).href;

if (invokedDirectly) {
  seedDatabase().catch((error) => {
    console.error("[db:seed] Seed script failed", error);
    process.exitCode = 1;
  });
}
