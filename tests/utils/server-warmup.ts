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
 * Maximum number of characters preserved from the response body when a warm-up
 * request fails. Next.js overlay payloads can be very large; trimming them
 * keeps the logged context actionable without overwhelming the test output.
 */
const RESPONSE_PREVIEW_MAX_LENGTH = 200;

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
        const preview = await getResponsePreview(response);

        if (!response.ok) {
          await drainResponse(response);
          throw new WarmupResponseError({
            url,
            attempt,
            attempts,
            status: response.status,
            preview,
          });
        }

        // Drain the response stream so Node releases the underlying socket.
        await drainResponse(response);
        break;
      } catch (error) {
        const description = describeFailure({
          error,
          url,
          attempt,
          attempts,
        });

        if (attempt === attempts) {
          throw new Error(
            `Failed to warm Next.js route: ${url}. ${description.message}`,
            description.cause ? { cause: description.cause } : undefined,
          );
        }

        console.warn(
          `[warmup] ${description.message}. Retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${attempts}).`,
        );

        await delay(retryDelayMs);
      }
    }
  }
}

/**
 * Drain the response body to completion so Node.js can recycle the TCP socket
 * for subsequent warm-up requests.
 */
async function drainResponse(response: Response) {
  try {
    await response.arrayBuffer();
  } catch {
    // The warm-up already failed, so there is no extra diagnostic value in
    // surfacing the drain error to the caller.
  }
}

/**
 * Extract a trimmed preview of the response payload to aid debugging. We clone
 * the response before reading so the original stream can still be consumed when
 * we drain it.
 */
async function getResponsePreview(response: Response): Promise<string | null> {
  try {
    const text = await response.clone().text();
    const normalised = normaliseWhitespace(text);

    if (normalised.length === 0) {
      return null;
    }

    if (normalised.length <= RESPONSE_PREVIEW_MAX_LENGTH) {
      return normalised;
    }

    return `${normalised.slice(0, RESPONSE_PREVIEW_MAX_LENGTH)}…`;
  } catch {
    return null;
  }
}

function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

class WarmupResponseError extends Error {
  readonly status: number;
  readonly preview: string | null;
  readonly attempt: number;
  readonly attempts: number;

  constructor({
    url,
    attempt,
    attempts,
    status,
    preview,
  }: {
    url: string;
    attempt: number;
    attempts: number;
    status: number;
    preview: string | null;
  }) {
    super(`Attempt ${attempt}/${attempts} for ${url} returned status ${status}`);
    this.status = status;
    this.preview = preview;
    this.attempt = attempt;
    this.attempts = attempts;
  }
}

function describeFailure({
  error,
  url,
  attempt,
  attempts,
}: {
  error: unknown;
  url: string;
  attempt: number;
  attempts: number;
}): { message: string; cause?: Error } {
  if (error instanceof WarmupResponseError) {
    const preview = error.preview ? ` Preview: "${error.preview}".` : "";

    return {
      message: `Attempt ${error.attempt}/${error.attempts} for ${url} failed with status ${error.status}.${preview}`,
      cause: error,
    };
  }

  const fallbackMessage =
    error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

  return {
    message: `Attempt ${attempt}/${attempts} for ${url} failed with ${fallbackMessage}`,
    cause: error instanceof Error ? error : undefined,
  };
}
