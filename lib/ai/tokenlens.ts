/**
 * Determine whether the TokenLens model catalog should be fetched from the
 * network for the current request lifecycle.
 *
 * The Playwright end-to-end environment runs in an offline sandbox, so any
 * outbound requests to TokenLens would fail with `ENETUNREACH` and spam the
 * test logs.  By consulting the `PLAYWRIGHT` environment variable—which is set
 * by the Playwright configuration—we can short-circuit those requests while
 * still leaving the production behaviour intact.
 */
export function shouldFetchTokenlensCatalog(
  env: NodeJS.ProcessEnv
): boolean {
  return env.PLAYWRIGHT !== "true";
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
