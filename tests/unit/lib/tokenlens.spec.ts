import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTokenlensEnvironment,
  shouldFetchTokenlensCatalog,
} from "@/lib/ai/tokenlens";

/**
 * The helper reads from `process.env`, so we snapshot the original values and
 * restore them after every test.  This keeps the suite hermetic even when other
 * tests mutate `process.env` at runtime.
 */
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("shouldFetchTokenlensCatalog", () => {
  it("returns false when the PLAYWRIGHT flag is enabled", () => {
    const env = createTokenlensEnvironment({ PLAYWRIGHT: "true" });

    expect(shouldFetchTokenlensCatalog(env)).toBe(false);
  });

  it("disables remote fetches for alternate Playwright indicators", () => {
    const env = createTokenlensEnvironment({
      PLAYWRIGHT: undefined,
      PLAYWRIGHT_TEST_BASE_URL: "http://localhost:3000",
    });

    expect(shouldFetchTokenlensCatalog(env)).toBe(false);
  });

  it("treats client-only Playwright flags as hermetic", () => {
    const env = createTokenlensEnvironment({
      PLAYWRIGHT: undefined,
      NEXT_PUBLIC_PLAYWRIGHT: "true",
    });

    expect(shouldFetchTokenlensCatalog(env)).toBe(false);
  });

  it("keeps the catalog fetch enabled in production environments", () => {
    const env = createTokenlensEnvironment({
      PLAYWRIGHT: "false",
      PLAYWRIGHT_TEST_BASE_URL: undefined,
      NEXT_PUBLIC_PLAYWRIGHT: undefined,
    });

    expect(shouldFetchTokenlensCatalog(env)).toBe(true);
  });
});

describe("createTokenlensEnvironment", () => {
  it("merges overrides without mutating process.env", () => {
    const baseEnv = { ...process.env };
    const env = createTokenlensEnvironment({ PLAYWRIGHT: "true" });

    expect(env.PLAYWRIGHT).toBe("true");
    expect(process.env).toEqual(baseEnv);
  });
});
