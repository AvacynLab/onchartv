import { z } from "zod";

import { assertSupportedSymbol, logRouteLatency, now, resolveClientKey } from "@/lib/finance/api-utils";
import { getMarketDataAdapter } from "@/lib/finance/server-adapter";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ChatSDKError } from "@/lib/errors";

/** Validates the query parameters accepted by the quote endpoint. */
const querySchema = z.object({
  symbol: z
    .string({ required_error: "symbol is required" })
    .min(1, "symbol must not be empty"),
});

/**
 * Returns the latest mock price for a supported symbol. The handler applies a
 * lightweight rate limit so rogue agents cannot spam the endpoint during
 * development.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = now();
  const clientKey = resolveClientKey(request);

  try {
    const rateLimit = enforceRateLimit({
      key: `finance:quote:${clientKey}`,
      limit: 60,
      windowMs: 60_000,
    });

    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = querySchema.safeParse(params);

    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new ChatSDKError("bad_request:api", detail);
    }

    const metadata = assertSupportedSymbol(parsed.data.symbol);
    const adapter = getMarketDataAdapter();
    const quote = await adapter.quote({ symbol: metadata.symbol });

    return Response.json({
      symbol: metadata.symbol,
      exchange: metadata.exchange,
      currency: metadata.currency,
      price: quote.price,
      timestamp: quote.timestamp,
      rateLimit,
      source: "mock",
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    console.error("[api:finance.quote] unexpected error", error);
    return Response.json(
      { code: "internal_error:api", message: "Unexpected error while fetching quote." },
      { status: 500 }
    );
  } finally {
    logRouteLatency("finance.quote", startedAt, { clientKey });
  }
}
