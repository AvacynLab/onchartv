/**
 * Centralised helpers toggling verbose Playwright streaming diagnostics. The
 * logic is reused across test utilities and client components so all debug
 * output reacts to the same environment variables and global override.
 */
const STREAM_DEBUG_FLAG_VALUES = new Set(["1", "true", "on", "yes"]);

const resolveEnvFlag = () => {
  if (typeof process === "undefined") {
    return "";
  }

  const candidates = [
    process.env.PLAYWRIGHT_STREAM_DEBUG,
    process.env.CI_PLAYWRIGHT_STREAM_DEBUG,
    process.env.NEXT_PUBLIC_PLAYWRIGHT_STREAM_DEBUG,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && STREAM_DEBUG_FLAG_VALUES.has(trimmed.toLowerCase())) {
      return trimmed.toLowerCase();
    }
  }

  return "";
};

const resolveGlobalFlag = () => {
  const globalFlag = (globalThis as {
    __PLAYWRIGHT_STREAM_DEBUG__?: unknown;
  }).__PLAYWRIGHT_STREAM_DEBUG__;

  if (typeof globalFlag === "boolean") {
    return globalFlag;
  }

  if (typeof globalFlag === "string") {
    const trimmed = globalFlag.trim().toLowerCase();
    if (STREAM_DEBUG_FLAG_VALUES.has(trimmed)) {
      return true;
    }
    return false;
  }

  return false;
};

export const isPlaywrightStreamDebugEnabled = (): boolean => {
  const envFlag = resolveEnvFlag();

  if (envFlag) {
    return true;
  }

  return resolveGlobalFlag();
};

export const logPlaywrightStreamDebug = (
  scope: string,
  event: string,
  payload: () => Record<string, unknown> | null,
  options: { withTimestamp?: boolean } = {},
): void => {
  if (!isPlaywrightStreamDebugEnabled()) {
    return;
  }

  const { withTimestamp = false } = options;
  const prefix = withTimestamp
    ? `[${scope}.stream-debug] ${new Date().toISOString()} ${event}`
    : `[${scope}.stream-debug] ${event}`;

  let resolved: Record<string, unknown> | null;

  try {
    resolved = payload();
  } catch (error) {
    console.info(prefix, { error });
    return;
  }

  console.info(prefix, resolved);
};
