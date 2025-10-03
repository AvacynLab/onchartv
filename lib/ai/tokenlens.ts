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
export function createTokenlensEnvironment(
  overrides: Partial<Record<keyof NodeJS.ProcessEnv, string | undefined>>
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
  } as NodeJS.ProcessEnv;
}
