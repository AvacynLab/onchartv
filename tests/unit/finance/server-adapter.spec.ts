import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { HttpMarketDataAdapter, InMemoryMarketDataAdapter } from "@/lib/finance/data-adapter";

/**
 * Ensures the server-side adapter factory respects feature flags and gracefully
 * falls back to deterministic mocks when configuration is incomplete.
 */
describe("getMarketDataAdapter", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
    vi.restoreAllMocks();
  });

  it("returns the in-memory adapter by default", async () => {
    const module = await import("@/lib/finance/server-adapter");
    const adapter = module.getMarketDataAdapter();
    expect(adapter.constructor.name).toBe(InMemoryMarketDataAdapter.name);
  });

  it("falls back to mocks when the feature flag lacks configuration", async () => {
    process.env.FEATURE_USE_REAL_DATA = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const module = await import("@/lib/finance/server-adapter");
    const adapter = module.getMarketDataAdapter();

    expect(adapter.constructor.name).toBe(InMemoryMarketDataAdapter.name);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Falling back to deterministic mocks")
    );
  });

  it("instantiates the HTTP adapter when all inputs are provided", async () => {
    process.env.FEATURE_USE_REAL_DATA = "true";
    process.env.MARKET_DATA_API_BASE_URL = "https://provider.test/api";
    process.env.MARKET_DATA_API_KEY = "secret";

    const module = await import("@/lib/finance/server-adapter");
    const adapter = module.getMarketDataAdapter();

    expect(adapter.constructor.name).toBe(HttpMarketDataAdapter.name);
  });
});
