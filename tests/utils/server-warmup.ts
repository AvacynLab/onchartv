/**
 * Sequentially request a set of routes to warm up the Next.js dev server.
 *
 * The first request to a route in development triggers Turbopack compilation.
 * During Playwright runs this can manifest as flaky `ERR_EMPTY_RESPONSE`
 * failures when the SPA attempts to navigate before the compilation finishes.
 * Issuing warm-up requests ahead of the interactive steps keeps the dev
 * server hot and reduces the chance of Playwright hitting an abort while the
 * page is still compiling.
 */
export type WarmupOptions = {
  /**
   * List of pathnames (or full URLs) to prefetch. Paths will be resolved
   * relative to the provided base URL.
   */
  routes?: readonly string[];
  /**
   * Per-request timeout in milliseconds. Defaults to 30 seconds which gives
   * Turbopack enough headroom to compile complex routes the first time.
   */
  timeoutMs?: number;
  /**
   * Allow injecting a mocked fetch implementation from unit tests.
   */
  fetchImpl?: typeof fetch;
  /**
   * Maximum number of attempts for each warm-up request. Defaults to three so
   * we retry once more after an initial compilation timeout.
   */
  maxAttempts?: number;
  /**
   * Delay (in milliseconds) between retries. Defaults to one second which is
   * long enough for the dev server to finish compiling after the first miss.
   */
  retryDelayMs?: number;
};

const DEFAULT_WARMUP_ROUTES = ["/", "/register", "/login", "/api/history?limit=1"] as const;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

/**
 * Sleep helper that can be awaited inside retry loops.
 */
function delay(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function warmupNextRoutes(
  baseURL: string,
  options: WarmupOptions = {}
): Promise<void> {
  const {
    routes = DEFAULT_WARMUP_ROUTES,
    timeoutMs = 30_000,
    fetchImpl = fetch,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = options;

  const attempts = Math.max(1, maxAttempts);

  for (const route of routes) {
    const url = new URL(route, baseURL).toString();

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });

        if (!response.ok) {
          throw new Error(`Warmup request for ${url} failed with status ${response.status}`);
        }

        // Drain the response stream so Node releases the underlying socket.
        await response.arrayBuffer().catch(() => undefined);
        break;
      } catch (error) {
        if (attempt === attempts) {
          throw new Error(`Failed to warm Next.js route: ${url}`, { cause: error });
        }

        await delay(retryDelayMs);
      }
    }
  }
}
