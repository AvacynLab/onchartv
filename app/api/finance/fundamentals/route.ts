import { z } from "zod";

import { assertSupportedSymbol, logRouteLatency, now, resolveClientKey } from "@/lib/finance/api-utils";
import { FUNDAMENTAL_SNAPSHOTS } from "@/lib/finance/mock-data";
import { ChatSDKError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/ratelimit";

/** Query validation used by the fundamentals endpoint. */
const querySchema = z.object({
  symbol: z
    .string({ required_error: "symbol is required" })
    .min(1, "symbol must not be empty"),
});

/**
 * Returns a deterministic snapshot of key financial ratios. The payload is kept
 * intentionally compact so it can be embedded into artefacts or tool responses
 * without further processing.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = now();
  const clientKey = resolveClientKey(request);

  try {
    const rateLimit = enforceRateLimit({
      key: `finance:fundamentals:${clientKey}`,
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
    const snapshot = FUNDAMENTAL_SNAPSHOTS[metadata.symbol];

    if (!snapshot) {
      throw new ChatSDKError(
        "bad_request:api",
        `No fundamentals are available for '${metadata.symbol}'.`
      );
    }

    return Response.json({
      symbol: metadata.symbol,
      exchange: metadata.exchange,
      currency: metadata.currency,
      metrics: snapshot,
      rateLimit,
      source: "mock",
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    console.error("[api:finance.fundamentals] unexpected error", error);
    return Response.json(
      { code: "internal_error:api", message: "Unexpected error while fetching fundamentals." },
      { status: 500 }
    );
  } finally {
    logRouteLatency("finance.fundamentals", startedAt, { clientKey });
  }
}
