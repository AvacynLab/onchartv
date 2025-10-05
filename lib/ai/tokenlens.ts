import { isPlaywrightLikeEnvironment } from "./playwright-env";

/**
 * Determine whether the TokenLens model catalog should be fetched from the
 * network for the current request lifecycle.
 *
 * The Playwright end-to-end environment runs in an offline sandbox, so any
 * outbound requests to TokenLens would fail with `ENETUNREACH` and spam the
 * test logs. Rather than keying exclusively on `PLAYWRIGHT`, we reuse
 * {@link isPlaywrightLikeEnvironment} so every recognised Playwright flag
 * (e.g. `PLAYWRIGHT_TEST_BASE_URL`, `CI_PLAYWRIGHT`, `NEXT_PUBLIC_PLAYWRIGHT`)
 * bypasses the remote fetch while production deployments still retrieve the
 * live catalog.
 */
export function shouldFetchTokenlensCatalog(
  env: NodeJS.ProcessEnv
): boolean {
  return !isPlaywrightLikeEnvironment(env);
}

/**
 * Helper exposed for tests so they can toggle the Playwright flag without
 * mutating the global `process.env` object.
 */
const TOKENLENS_ENV_KEYS = [
  "PLAYWRIGHT",
  "CI_PLAYWRIGHT",
  "PLAYWRIGHT_TEST_BASE_URL",
  "NEXT_PUBLIC_PLAYWRIGHT",
] as const;

/**
 * Build a deterministic environment snapshot for TokenLens unit tests.
 *
 * Tests that rely on this helper run under the same CI configuration as the
 * Playwright harness, which means flags such as `CI_PLAYWRIGHT` or
 * `NEXT_PUBLIC_PLAYWRIGHT` may already be defined on `process.env`. When we
 * blindly spread the full environment we end up inheriting those flags and the
 * catalog guard incorrectly believes it is running inside Playwright. That
 * causes production-focused test cases to fail even though they explicitly set
 * overrides that should opt back in to the live catalog.
 *
 * To keep the helper deterministic we only copy the subset of variables the
 * guard reads and then apply the caller overrides. This mimics the behaviour of
 * `process.env` for the keys we care about while letting tests control the
 * Playwright detection logic precisely.
 */
export function createTokenlensEnvironment(
  overrides: Partial<Record<keyof NodeJS.ProcessEnv, string | undefined>>
): NodeJS.ProcessEnv {
  const snapshot = TOKENLENS_ENV_KEYS.reduce<NodeJS.ProcessEnv>((env, key) => {
    if (typeof process.env[key] !== "undefined") {
      env[key] = process.env[key];
    }
    return env;
  }, {} as NodeJS.ProcessEnv);

  return {
    ...snapshot,
    ...overrides,
  } as NodeJS.ProcessEnv;
}
