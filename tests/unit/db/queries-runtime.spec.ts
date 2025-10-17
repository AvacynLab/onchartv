import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { StructuredLogEntry } from "@/lib/logging";

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

  it("journalise un avertissement structuré lorsque le cache Playwright est corrompu", async () => {
    process.env.PLAYWRIGHT = "true";
    vi.resetModules();

    const authDir = path.resolve(process.cwd(), "tests/.auth");
    const persistedPath = path.join(authDir, "playwright-users.json");

    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(persistedPath, "{malformed", "utf-8");

    const logging = await import("@/lib/logging");
    const warnSpy = vi
      .spyOn(logging, "logWarning")
      .mockImplementation((context, message, extra) => ({
        context,
        level: "warn",
        message: typeof message === "string" ? message : undefined,
        timestamp: new Date().toISOString(),
        extra,
      }) satisfies StructuredLogEntry);

    const queries = await import("@/lib/db/queries");

    await queries.createUser("log@example.com", "secret");

    expect(warnSpy).toHaveBeenCalledWith(
      "db:queries",
      "Failed to hydrate Playwright users from persisted store",
      expect.objectContaining({
        error: expect.any(SyntaxError),
      })
    );

    queries.__resetInMemoryDbForTests();
    warnSpy.mockRestore();

    if (fs.existsSync(persistedPath)) {
      fs.rmSync(persistedPath);
    }
  });
});
