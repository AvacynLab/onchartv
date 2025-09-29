/**
 * Unit coverage for the password hashing utilities. These assertions guarantee
 * that our Playwright runs use a lightweight bcrypt cost factor while
 * production builds keep the stronger default.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Helper that forces Node.js to treat each import as a fresh module evaluation
 * so environment variable changes take effect.
 */
async function importFresh<T>(specifier: string): Promise<T> {
  return import(`${specifier}?${randomUUID()}`) as Promise<T>;
}

test.describe("generateHashedPassword", () => {
  const originalEnv = {
    PLAYWRIGHT: process.env.PLAYWRIGHT,
    PLAYWRIGHT_TEST_BASE_URL: process.env.PLAYWRIGHT_TEST_BASE_URL,
    CI_PLAYWRIGHT: process.env.CI_PLAYWRIGHT,
  };

  test.afterEach(() => {
    if (originalEnv.PLAYWRIGHT === undefined) {
      delete process.env.PLAYWRIGHT;
    } else {
      process.env.PLAYWRIGHT = originalEnv.PLAYWRIGHT;
    }

    if (originalEnv.PLAYWRIGHT_TEST_BASE_URL === undefined) {
      delete process.env.PLAYWRIGHT_TEST_BASE_URL;
    } else {
      process.env.PLAYWRIGHT_TEST_BASE_URL = originalEnv.PLAYWRIGHT_TEST_BASE_URL;
    }

    if (originalEnv.CI_PLAYWRIGHT === undefined) {
      delete process.env.CI_PLAYWRIGHT;
    } else {
      process.env.CI_PLAYWRIGHT = originalEnv.CI_PLAYWRIGHT;
    }
  });

  test("falls back to a faster bcrypt cost when Playwright is enabled", async () => {
    process.env.PLAYWRIGHT = "true";

    const { generateHashedPassword, generateDummyPassword } = await importFresh<
      typeof import("../../lib/db/utils")
    >("../../lib/db/utils");

    const hash = generateHashedPassword("secret-value");
    const dummyHash = generateDummyPassword();

    assert.equal(
      hash.slice(4, 6),
      "04",
      "Playwright runs should use four bcrypt rounds to speed up registration",
    );

    assert.equal(
      dummyHash.slice(4, 6),
      "04",
      "Dummy passwords should match the Playwright cost factor as well",
    );
  });

  test("keeps the production bcrypt cost factor by default", async () => {
    delete process.env.PLAYWRIGHT;
    delete process.env.PLAYWRIGHT_TEST_BASE_URL;
    delete process.env.CI_PLAYWRIGHT;

    const { generateHashedPassword } = await importFresh<
      typeof import("../../lib/db/utils")
    >("../../lib/db/utils");

    const hash = generateHashedPassword("production-secret");

    assert.equal(
      hash.slice(4, 6),
      "10",
      "Non-Playwright environments should keep the stronger cost factor",
    );
  });
});
