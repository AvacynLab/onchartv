import { z } from "zod";

import {
  assertFinanceFeatureEnabled,
  assertSupportedSymbol,
  logRouteLatency,
  now,
  resolveClientKey,
} from "@/lib/finance/api-utils";
import { NEWS_ITEMS } from "@/lib/finance/mock-data";
import { ChatSDKError } from "@/lib/errors";
import { logError } from "@/lib/logging";
import { enforceRateLimit } from "@/lib/ratelimit";

const querySchema = z.object({
  symbol: z
    .string({ required_error: "symbol is required" })
    .min(1, "symbol must not be empty"),
  limit: z.string().optional(),
});

/**
 * Returns curated news headlines for the requested symbol. Sentiment scores are
 * included so the agent can quickly summarise the tone of the feed.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = now();
  const clientKey = resolveClientKey(request);
  let symbol: string | undefined;
  let limit: number | undefined;

  try {
    assertFinanceFeatureEnabled();
    const rateLimit = enforceRateLimit({
      key: `finance:news:${clientKey}`,
      limit: 30,
      windowMs: 60_000,
    });

    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = querySchema.safeParse(params);

    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new ChatSDKError("bad_request:api", detail);
    }

    const metadata = assertSupportedSymbol(parsed.data.symbol);
    symbol = metadata.symbol;

    /**
     * Normalise the optional `limit` query and reject non-integer payloads so
     * Playwright assertions remain stable across environments.
     */
    const rawLimit = parsed.data.limit?.trim();
    if (rawLimit && !/^\d+$/.test(rawLimit)) {
      throw new ChatSDKError(
        "bad_request:api",
        "Parameter 'limit' must be a positive integer when provided."
      );
    }

    limit = rawLimit ? Number.parseInt(rawLimit, 10) : 10;

    if (Number.isNaN(limit) || limit <= 0) {
      throw new ChatSDKError(
        "bad_request:api",
        "Parameter 'limit' must be a positive integer when provided."
      );
    }

    const items = NEWS_ITEMS.filter((item) => item.symbol === metadata.symbol)
      .slice()
      .sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      )
      .slice(0, limit);

    return Response.json({
      symbol: metadata.symbol,
      exchange: metadata.exchange,
      items,
      count: items.length,
      rateLimit,
      source: "mock",
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    logError("api:finance.news", error, { clientKey, symbol, limit });
    return Response.json(
      {
        error: {
          code: "internal_error:api",
          message: "Unexpected error while fetching news.",
        },
      },
      { status: 500 }
    );
  } finally {
    logRouteLatency("finance.news", startedAt, { clientKey });
  }
}
