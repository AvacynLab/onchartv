import { performance } from "node:perf_hooks";

/**
 * Logger subset used by {@link withStepTiming}. Keeping the interface narrow
 * allows tests to inject spies without relying on the entire `console` API.
 */
export type StepTimingLogger = Pick<typeof console, "info" | "warn">;

/**
 * Configuration for {@link withStepTiming}. Consumers can adjust the warning
 * threshold, logger, and time source to facilitate deterministic unit tests.
 */
export type StepTimingOptions<T> = {
  /**
   * Human readable label describing the asynchronous operation being timed.
   */
  label: string;
  /**
   * Optional duration threshold (in milliseconds). When the measured runtime
   * exceeds this value the helper emits an additional warning so long-running
   * steps become visible in Playwright logs.
   */
  thresholdMs?: number;
  /**
   * Hook that executes the operation to be measured. The return value is
   * forwarded back to the caller once the step completes.
   */
  task: () => Promise<T> | T;
  /**
   * Logger used for the informational and warning messages. Defaults to the
   * global console but can be substituted in tests.
   */
  logger?: StepTimingLogger;
  /**
   * Override for the monotonic clock. Vitest tests inject a deterministic
   * function so assertions remain stable regardless of machine speed.
   */
  now?: () => number;
};

const defaultLogger: StepTimingLogger = console;

const defaultNow = () => performance.now();

/**
 * Execute the provided asynchronous task while logging how long it took.
 *
 * The helper always reports the elapsed time. When the duration exceeds the
 * configured threshold a secondary warning is logged to highlight potential
 * hotspots that could cause Playwright’s 240s setup budget to be exceeded.
 */
export async function withStepTiming<T>({
  label,
  thresholdMs = Number.POSITIVE_INFINITY,
  task,
  logger = defaultLogger,
  now = defaultNow,
}: StepTimingOptions<T>): Promise<T> {
  const start = now();

  try {
    const result = await task();
    const duration = now() - start;

    logger.info(`[#timing] ${label} completed in ${formatDuration(duration)}.`);

    if (Number.isFinite(thresholdMs) && duration > thresholdMs) {
      logger.warn(
        `[#timing] ${label} exceeded ${formatDuration(thresholdMs)} (took ${formatDuration(duration)}).`,
      );
    }

    return result;
  } catch (error) {
    const duration = now() - start;
    logger.warn(`[#timing] ${label} failed after ${formatDuration(duration)}.`, {
      cause: error,
    });
    throw error;
  }
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) {
    return "unknown";
  }

  if (durationMs >= 1_000) {
    const seconds = durationMs / 1_000;
    return `${seconds.toFixed(1)}s`;
  }

  return `${Math.max(0, Math.round(durationMs))}ms`;
}
