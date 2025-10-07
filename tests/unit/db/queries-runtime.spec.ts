import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Preserve the original hermetic flags so the suite can toggle the environment
 * without leaking state to unrelated tests.
 */
const ORIGINAL_ENV = {
  PLAYWRIGHT: process.env.PLAYWRIGHT,
  CI_PLAYWRIGHT: process.env.CI_PLAYWRIGHT,
  PLAYWRIGHT_TEST_BASE_URL: process.env.PLAYWRIGHT_TEST_BASE_URL,
};

vi.mock("server-only", () => ({}));

describe("lib/db/queries hermetic toggles", () => {
  afterEach(() => {
    // Reload the module graph so the upcoming import observes the current
    // environment instead of reusing a cached copy initialised with a different
    // Playwright flag.
    vi.resetModules();
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  it("enables the in-memory store when PLAYWRIGHT toggles after import", async () => {
    delete process.env.PLAYWRIGHT;
    delete process.env.CI_PLAYWRIGHT;
    delete process.env.PLAYWRIGHT_TEST_BASE_URL;

    vi.resetModules();

    const queries = await import("../../../lib/db/queries");

    expect(() => queries.__resetInMemoryDbForTests()).toThrow(
      /outside the test environment/
    );

    process.env.PLAYWRIGHT = "true";

    expect(() => queries.__resetInMemoryDbForTests()).not.toThrow();

    await queries.createUser("toggle@example.com", "secret");
    const [createdUser] = await queries.getUser("toggle@example.com");

    expect(createdUser?.email).toBe("toggle@example.com");

    queries.__resetInMemoryDbForTests();
  });
});
