import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Preserve the original Playwright flag so the suite can toggle the hermetic
 * environment without leaking state to unrelated tests.
 */
const ORIGINAL_PLAYWRIGHT = process.env.PLAYWRIGHT;

vi.mock("server-only", () => ({}));

describe("lib/db/queries hermetic toggles", () => {
  afterEach(() => {
    // Reload the module graph so the upcoming import observes the current
    // environment instead of reusing a cached copy initialised with a different
    // Playwright flag.
    vi.resetModules();
    if (ORIGINAL_PLAYWRIGHT) {
      process.env.PLAYWRIGHT = ORIGINAL_PLAYWRIGHT;
    } else {
      delete process.env.PLAYWRIGHT;
    }
  });

  afterAll(() => {
    if (ORIGINAL_PLAYWRIGHT) {
      process.env.PLAYWRIGHT = ORIGINAL_PLAYWRIGHT;
    } else {
      delete process.env.PLAYWRIGHT;
    }
  });

  it("enables the in-memory store when PLAYWRIGHT toggles after import", async () => {
    delete process.env.PLAYWRIGHT;

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
