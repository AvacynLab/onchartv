import fs from "node:fs";
import path from "node:path";

/**
 * Cache holder for the finance manual content so that repeated calls avoid
 * touching the filesystem during a single request lifecycle.
 */
let financeManualCache: string | null = null;

/**
 * Reads and memoises the finance system prompt.
 *
 * The prompt lives in `finance.md` to keep copywriting review-friendly.
 * When the file is missing in dev/test, we degrade gracefully by returning an
 * empty string so chat flows continue to work (the tests assert the presence of
 * the manual when the feature flag is enabled).
 */
export function getFinanceManualPrompt(): string {
  if (financeManualCache !== null) {
    return financeManualCache;
  }

  const manualPath = path.join(
    process.cwd(),
    "lib",
    "ai",
    "system-prompts",
    "finance.md"
  );

  try {
    financeManualCache = fs.readFileSync(manualPath, "utf8").trim();
  } catch (error) {
    // Provide context without leaking stack traces in production logs.
    console.warn("finance-manual: failed to load finance.md", error);
    financeManualCache = "";
  }

  return financeManualCache;
}

/**
 * Vitest resets run in the same process; expose a helper so tests can clear the
 * cached value between scenarios.
 */
export function __resetFinanceManualCacheForTests() {
  financeManualCache = null;
}
