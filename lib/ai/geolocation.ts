import { geolocation as vercelGeolocation } from "@vercel/functions";

import { logWarning } from "@/lib/logging";
import { isPlaywrightLikeEnvironment } from "./playwright-env";

/**
 * Canonical shape returned to chat callers after running the geolocation
 * helper. The data only keeps the fields consumed by the request hints so
 * callers do not have to guard against additional properties.
 */
export interface SimplifiedGeolocation {
  longitude?: number;
  latitude?: number;
  city?: string;
  country?: string;
}

const FALLBACK_LOCATION: Readonly<SimplifiedGeolocation> = Object.freeze({
  longitude: undefined,
  latitude: undefined,
  city: undefined,
  country: undefined,
});

/**
 * Dependencies accepted by the geolocation resolver so tests can provide
 * hermetic stubs without mutating process-wide state.
 */
interface ResolveRequestGeolocationOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly geolocationFn?: typeof vercelGeolocation;
  readonly onFailure?: typeof logWarning;
}

/**
 * Vercel's `geolocation` helper performs lookups based on the incoming
 * request. When Playwright runs in the offline sandbox or the resolver throws
 * (e.g. missing headers), we gracefully fall back to an empty payload so the
 * chat request keeps flowing without triggering network calls that would fail
 * with `ENETUNREACH`.
 */
export function resolveRequestGeolocation(
  request: Request,
  {
    env = process.env,
    geolocationFn = vercelGeolocation,
    onFailure = logWarning,
  }: ResolveRequestGeolocationOptions = {}
): SimplifiedGeolocation {
  if (isPlaywrightLikeEnvironment(env)) {
    // Avoid invoking the underlying helper in hermetic environments where the
    // lookup would attempt to reach external services.
    return { ...FALLBACK_LOCATION };
  }

  try {
    const rawResult = geolocationFn(request);

    if (!rawResult) {
      return { ...FALLBACK_LOCATION };
    }

    const { longitude, latitude, city, country } = rawResult;

    return {
      longitude: typeof longitude === "number" ? longitude : undefined,
      latitude: typeof latitude === "number" ? latitude : undefined,
      city: typeof city === "string" ? city : undefined,
      country: typeof country === "string" ? country : undefined,
    } satisfies SimplifiedGeolocation;
  } catch (error) {
    onFailure("chat.geolocation", "Falling back to empty geolocation", {
      error,
    });

    return { ...FALLBACK_LOCATION };
  }
}
