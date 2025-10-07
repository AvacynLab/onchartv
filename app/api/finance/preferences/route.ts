import { auth } from "@/app/(auth)/auth";
import {
  assertFinanceFeatureEnabled,
  logRouteLatency,
  now,
  resolveClientKey,
} from "@/lib/finance/api-utils";
import {
  DEFAULT_FINANCE_PREFERENCES,
  financePreferencesSchema,
  type FinancePreferences,
} from "@/lib/finance/preferences";
import {
  getFinancePreferencesByUserId,
  upsertFinancePreferences,
} from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { logError } from "@/lib/logging";
import { enforceRateLimit } from "@/lib/ratelimit";

const patchSchema = financePreferencesSchema;

const clonePreferences = (
  preferences: FinancePreferences
): FinancePreferences => ({
  markets: [...preferences.markets],
  defaultIndicators: preferences.defaultIndicators.map((indicator) => ({
    ...indicator,
  })),
  explanationLevel: preferences.explanationLevel,
  showNews: preferences.showNews,
});

const toResponsePayload = (
  record: Awaited<ReturnType<typeof getFinancePreferencesByUserId>>
): { preferences: FinancePreferences; createdAt?: string; updatedAt?: string } => {
  if (!record) {
    return { preferences: clonePreferences(DEFAULT_FINANCE_PREFERENCES) };
  }

  return {
    preferences: {
      markets: [...record.markets],
      defaultIndicators: record.indicators.map((indicator) => ({
        ...indicator,
      })),
      explanationLevel: record.explanationLevel,
      showNews: record.showNews,
    },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
};

/**
 * Returns the saved finance preferences for the authenticated user. Defaults are
 * returned when a record is not present so the settings UI can render without an
 * extra round trip.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = now();
  const clientKey = resolveClientKey(request);
  let userId: string | undefined;

  try {
    assertFinanceFeatureEnabled();
    const rateLimit = enforceRateLimit({
      key: `finance:preferences:get:${clientKey}`,
      limit: 60,
      windowMs: 60_000,
    });

    const session = await auth();

    if (!session?.user) {
      throw new ChatSDKError(
        "unauthorized:auth",
        "Authentication requise pour consulter les préférences."
      );
    }

    userId = session.user.id;
    const record = await getFinancePreferencesByUserId({
      userId,
    });
    const payload = toResponsePayload(record);

    return Response.json({
      ...payload,
      rateLimit,
      source: record ? "database" : "default",
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    logError("api:finance.preferences:get", error, { clientKey, userId });
    return Response.json(
      {
        error: {
          code: "internal_error:api",
          message: "Unexpected error while loading finance preferences.",
        },
      },
      { status: 500 }
    );
  } finally {
    logRouteLatency("finance.preferences:get", startedAt, { clientKey });
  }
}

/**
 * Persists the finance preferences for the authenticated user. Values are
 * validated with zod before hitting the database so the UI receives actionable
 * feedback when something is amiss.
 */
export async function PATCH(request: Request): Promise<Response> {
  const startedAt = now();
  const clientKey = resolveClientKey(request);
  let userId: string | undefined;

  try {
    assertFinanceFeatureEnabled();
    const rateLimit = enforceRateLimit({
      key: `finance:preferences:patch:${clientKey}`,
      limit: 30,
      windowMs: 60_000,
    });

    const session = await auth();

    if (!session?.user) {
      throw new ChatSDKError(
        "unauthorized:auth",
        "Authentication requise pour modifier les préférences."
      );
    }

    userId = session.user.id;
    let json: unknown;

    try {
      json = await request.json();
    } catch {
      throw new ChatSDKError(
        "bad_request:api",
        "Le corps de la requête doit être un JSON valide."
      );
    }

    const parsed = patchSchema.safeParse(json);

    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new ChatSDKError("bad_request:api", detail);
    }

    const preferences = parsed.data;
    const record = await upsertFinancePreferences({
      userId,
      markets: preferences.markets,
      defaultIndicators: preferences.defaultIndicators,
      explanationLevel: preferences.explanationLevel,
      showNews: preferences.showNews,
    });

    const payload = toResponsePayload(record);

    return Response.json({
      ...payload,
      rateLimit,
      source: "database",
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    logError("api:finance.preferences:patch", error, { clientKey, userId });
    return Response.json(
      {
        error: {
          code: "internal_error:api",
          message: "Unexpected error while saving finance preferences.",
        },
      },
      { status: 500 }
    );
  } finally {
    logRouteLatency("finance.preferences:patch", startedAt, { clientKey });
  }
}
