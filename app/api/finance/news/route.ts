import { z } from "zod";

import { assertSupportedSymbol, logRouteLatency, now, resolveClientKey } from "@/lib/finance/api-utils";
import { NEWS_ITEMS } from "@/lib/finance/mock-data";
import { ChatSDKError } from "@/lib/errors";
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

  try {
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
    const limit = parsed.data.limit ? Number.parseInt(parsed.data.limit, 10) : 10;

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

    console.error("[api:finance.news] unexpected error", error);
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
