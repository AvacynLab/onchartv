import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Dynamically load the Playwright configuration while temporarily overriding
 * environment variables. Each import uses a cache-busting query parameter so
 * we observe the computed worker count for the requested scenario without
 * polluting global state.
 */
async function loadConfigWithEnv(overrides: Record<string, string | undefined>) {
  const backup = { ...process.env } as Record<string, string | undefined>;

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const moduleUrl = new URL(
    `../../playwright.config.ts?worker-test=${Math.random()}`,
    import.meta.url
  );
  const imported = await import(moduleUrl.href);
  const config = imported.default;

  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, backup);

  return config;
}

describe("playwright worker selection", () => {
  it("limits workers when hermetic Playwright flags are present", async () => {
    const config = await loadConfigWithEnv({
      PLAYWRIGHT: "true",
      CI: undefined,
      CI_PLAYWRIGHT: undefined,
      PLAYWRIGHT_TEST_BASE_URL: undefined,
    });

    assert.equal(config.workers, 2);
    assert.equal(config.fullyParallel, false);
  });

  it("restores the higher worker count for regular local runs", async () => {
    const config = await loadConfigWithEnv({
      PLAYWRIGHT: undefined,
      CI: undefined,
      CI_PLAYWRIGHT: undefined,
      PLAYWRIGHT_TEST_BASE_URL: undefined,
    });

    assert.equal(config.workers, 8);
    assert.equal(config.fullyParallel, true);
  });

  it("forces two workers when CI is enabled", async () => {
    const config = await loadConfigWithEnv({
      CI: "true",
      PLAYWRIGHT: undefined,
      CI_PLAYWRIGHT: undefined,
      PLAYWRIGHT_TEST_BASE_URL: undefined,
    });

    assert.equal(config.workers, 2);
    assert.equal(config.fullyParallel, true);
  });
});
