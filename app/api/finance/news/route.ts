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

const MAX_NEWS_ITEMS = 50;

const querySchema = z.object({
  symbol: z
    .string({ required_error: "symbol is required" })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "symbol must not be empty"),
  limit: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        return undefined;
      }

      const trimmed = value.trim();

      if (trimmed.length === 0) {
        return undefined;
      }

      if (!/^\d+$/.test(trimmed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Parameter 'limit' must be a positive integer when provided.",
        });
        return z.NEVER;
      }

      const parsed = Number.parseInt(trimmed, 10);

      if (parsed <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Parameter 'limit' must be a positive integer when provided.",
        });
        return z.NEVER;
      }

      if (parsed > MAX_NEWS_ITEMS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Parameter 'limit' cannot exceed ${MAX_NEWS_ITEMS}.`,
        });
        return z.NEVER;
      }

      return parsed;
    }),
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

    if (!rateLimit.allowed) {
      throw new ChatSDKError(
        "rate_limit:api",
        "Finance news quota exceeded for this client."
      );
    }

    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = querySchema.safeParse(params);

    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new ChatSDKError("bad_request:api", detail);
    }

    const metadata = assertSupportedSymbol(parsed.data.symbol);
    symbol = metadata.symbol;
    limit = parsed.data.limit ?? 10;

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
