/**
 * Poll the Next.js dev server health endpoint until it responds successfully.
 *
 * Playwright occasionally races the development server startup, especially
 * when we reuse an existing manual instance via `PLAYWRIGHT_MANUAL_SERVER`.
 * Hitting `/ping` repeatedly before navigating to `/register` prevents early
 * connection-refused errors that would otherwise abort `auth.setup`.
 */
export type WaitForServerReadyOptions = {
  /**
   * Maximum number of attempts to probe the health endpoint.
   */
  attempts?: number;
  /**
   * Delay (in milliseconds) between each retry.
   */
  delayMs?: number;
  /**
   * Per-attempt request timeout to avoid hanging on stalled sockets.
   */
  timeoutMs?: number;
  /**
   * Injected fetch implementation for testing.
   */
  fetchImpl?: typeof fetch;
};

const DEFAULT_OPTIONS: Required<Omit<WaitForServerReadyOptions, "fetchImpl">> = {
  attempts: 20,
  delayMs: 500,
  timeoutMs: 5_000,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForServerReady(
  baseURL: string,
  options: WaitForServerReadyOptions = {}
): Promise<void> {
  const { fetchImpl = fetch, ...rest } = options;
  const { attempts, delayMs, timeoutMs } = { ...DEFAULT_OPTIONS, ...rest };
  const healthUrl = new URL("/ping", baseURL).toString();
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(healthUrl, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        return;
      }

      lastError = new Error(
        `Health check returned unexpected status ${response.status}`
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  const message = `Next.js dev server at ${healthUrl} did not respond after ${attempts} attempts.`;
  if (lastError instanceof Error) {
    throw new Error(message, { cause: lastError });
  }
  throw new Error(message);
}
