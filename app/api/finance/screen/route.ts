import { z } from "zod";

import { ChatSDKError } from "@/lib/errors";
import { FINANCE_ASSET_CATALOG } from "@/lib/finance/catalog";
import { FUNDAMENTAL_SNAPSHOTS } from "@/lib/finance/mock-data";
import { enforceRateLimit } from "@/lib/ratelimit";
import { logRouteLatency, now, resolveClientKey } from "@/lib/finance/api-utils";
import type { Asset } from "@/lib/db/schema";

/**
 * Validates the payload accepted by the screen endpoint. Only a tiny subset of
 * filters is exposed because the offline mocks intentionally cover a narrow set
 * of assets; keeping the schema tight makes the behaviour predictable in tests.
 */
const requestSchema = z
  .object({
    filters: z
      .object({
        minMarketCap: z
          .number()
          .min(0, "filters.minMarketCap must be zero or greater")
          .optional(),
        maxPeRatio: z
          .number()
          .min(0, "filters.maxPeRatio must be zero or greater")
          .optional(),
        assetTypes: z
          .array(
            z.enum([
              "equity",
              "crypto",
              "fx",
              "etf",
              "index",
              "commodity",
            ])
            /**
             * Keep the allowed asset classes aligned with the Asset.type enum so TypeScript
             * stays aware of the full catalogue and the runtime validation accepts any
             * metadata persisted through the migration.
             */
          )
          .max(3, "filters.assetTypes supports at most three entries")
          .optional(),
      })
      .default({}),
    limit: z
      .number()
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(25, "limit cannot exceed 25 results")
      .default(10),
  })
  .default({ filters: {}, limit: 10 });

/**
 * Runs a deterministic asset screener on top of the offline fundamental
 * snapshots. The endpoint mirrors the finance tool so agents and manual callers
 * receive the same filtered universe without performing network requests.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = now();
  const clientKey = resolveClientKey(request);

  try {
    const rateLimit = enforceRateLimit({
      key: `finance:screen:${clientKey}`,
      limit: 30,
      windowMs: 60_000,
    });

    const raw = await request.text();
    let json: unknown = {};

    if (raw.trim().length > 0) {
      try {
        json = JSON.parse(raw);
      } catch {
        throw new ChatSDKError("bad_request:api", "Request body must be valid JSON.");
      }
    }

    const parsed = requestSchema.safeParse(json ?? {});

    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new ChatSDKError("bad_request:api", detail);
    }

    const {
      filters: { minMarketCap, maxPeRatio, assetTypes },
      limit,
    } = parsed.data;

    const requestedTypes: ReadonlySet<Asset["type"]> | null = assetTypes
      ?
          /**
           * Explicitly widen the Set so the compiler keeps accepting any future
           * asset classes introduced by the relational schema. The run-time
           * values are still validated by Zod above, so the assertion simply
           * aligns both sides of the type comparison used below.
           */
          new Set<Asset["type"]>(assetTypes as Asset["type"][])
      : null;

    const matches = Object.values(FUNDAMENTAL_SNAPSHOTS)
      .filter((snapshot) => {
        if (typeof minMarketCap === "number" && snapshot.marketCap < minMarketCap) {
          return false;
        }

        if (
          typeof maxPeRatio === "number" &&
          snapshot.peRatio > 0 &&
          snapshot.peRatio > maxPeRatio
        ) {
          return false;
        }

        if (requestedTypes && requestedTypes.size > 0) {
          const metadata = FINANCE_ASSET_CATALOG[snapshot.symbol];
          if (!requestedTypes.has(metadata.type)) {
            return false;
          }
        }

        return true;
      })
      .map((snapshot) => {
        const metadata = FINANCE_ASSET_CATALOG[snapshot.symbol];

        return {
          symbol: metadata.symbol,
          name: metadata.name,
          type: metadata.type,
          exchange: metadata.exchange,
          marketCap: snapshot.marketCap,
          peRatio: snapshot.peRatio,
          dividendYield: snapshot.dividendYield,
        };
      })
      .sort((a, b) => b.marketCap - a.marketCap);

    return Response.json({
      type: "finance.screen" as const,
      totalMatches: matches.length,
      results: matches.slice(0, limit),
      appliedFilters: {
        minMarketCap: minMarketCap ?? null,
        maxPeRatio: maxPeRatio ?? null,
        assetTypes: assetTypes ?? [],
      },
      rateLimit,
      source: "mock",
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    console.error("[api:finance.screen] unexpected error", error);
    return Response.json(
      { code: "internal_error:api", message: "Unexpected error while screening assets." },
      { status: 500 }
    );
  } finally {
    logRouteLatency("finance.screen", startedAt, { clientKey });
  }
}
