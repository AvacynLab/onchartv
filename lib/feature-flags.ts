/**
 * Utilities for reading build-time feature flags both on the server and in the
 * browser. Finance experiences are guarded by `FEATURE_FINANCE` on the server
 * while client bundles rely on the mirrored `NEXT_PUBLIC_FEATURE_FINANCE`
 * replacement that Next.js injects at build time.
 */
const TRUTHY_FLAG_VALUES = new Set(["true", "1", "on", "yes"]);

interface ParseBooleanFlagOptions {
  /** Default value returned when the flag is absent or blank. */
  readonly defaultValue?: boolean;
}

/**
 * Normalises environment variables into booleans using a permissive set of
 * truthy strings so different deployment platforms (Vercel, GitHub Actions,
 * Docker) can reuse the same helper without case-sensitivity issues.
 */
export function parseBooleanFlag(
  rawValue: string | undefined,
  { defaultValue = true }: ParseBooleanFlagOptions = {}
): boolean {
  if (rawValue === undefined) {
    return defaultValue;
  }

  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return defaultValue;
  }

  return TRUTHY_FLAG_VALUES.has(trimmed.toLowerCase());
}

/**
 * Server-side finance toggle used by API routes and React Server Components.
 * Defaults to `true` so the feature remains available in local development
 * unless explicitly disabled.
 */
export function isFinanceFeatureEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return parseBooleanFlag(env.FEATURE_FINANCE, { defaultValue: true });
}

/**
 * Client-side finance toggle consumed by interactive components. Because Next
 * replaces `process.env.NEXT_PUBLIC_*` at build time, the helper executes at
 * runtime without needing additional global plumbing.
 */
export function isFinanceFeatureEnabledClient(): boolean {
  return parseBooleanFlag(process.env.NEXT_PUBLIC_FEATURE_FINANCE, {
    defaultValue: true,
  });
}
