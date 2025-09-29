import { isPlaywrightLikeEnvironment } from "@/lib/ai/playwright-env";

/**
 * Fallback secret used whenever the application runs outside production
 * without an explicit `AUTH_SECRET`/`NEXTAUTH_SECRET`. Playwright exercises the
 * full authentication flow locally, so providing a deterministic secret keeps
 * the suite hermetic while reminding developers to configure a strong value in
 * real deployments.
 */
export const NON_PRODUCTION_AUTH_SECRET = "onchartv-insecure-development-secret";

/**
 * Resolve the secret consumed by NextAuth.js. The helper prefers explicit
 * environment variables and only falls back to the deterministic constant when
 * we are not in production (or when the Playwright harness is active). This
 * keeps local development/test flows unblocked without accidentally starting a
 * production instance with a weak secret.
 */
export function resolveAuthSecret(
  env: NodeJS.ProcessEnv = process.env
): string {
  const configuredSecret = env.AUTH_SECRET ?? env.NEXTAUTH_SECRET;

  if (configuredSecret && configuredSecret.length > 0) {
    return configuredSecret;
  }

  if (
    (env.NODE_ENV && env.NODE_ENV !== "production") ||
    isPlaywrightLikeEnvironment(env)
  ) {
    return NON_PRODUCTION_AUTH_SECRET;
  }

  throw new Error(
    "Missing AUTH_SECRET environment variable. Set AUTH_SECRET or NEXTAUTH_SECRET before running NextAuth in production."
  );
}

/**
 * Convenience wrapper so middleware and other call-sites can probe whether the
 * current environment has a usable secret configured. The helper mirrors the
 * logic from {@link resolveAuthSecret} without throwing exceptions, which keeps
 * control flow tidy in places that already have sensible fallbacks.
 */
export function hasAuthSecret(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  try {
    return Boolean(resolveAuthSecret(env));
  } catch (_error) {
    return false;
  }
}
