import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lazily loads the concrete finance catalogue and mock fixtures. Other suites
 * mock the catalogue module, so we refresh the module registry before every
 * assertion to avoid leaking those doubles into this behaviour-focused suite.
 */
const loadFinanceModules = async () => {
  vi.unmock("@/lib/finance/catalog");
  vi.unmock("@/lib/finance/mock-data");

  const [catalog, mockData] = await Promise.all([
    import("@/lib/finance/catalog"),
    import("@/lib/finance/mock-data"),
  ]);

  return { catalog, mockData };
};

/**
 * Ensures the offline finance catalogue and mock fixtures stay aligned.
 */
describe("finance asset catalogue", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exposes metadata for every supported mock symbol", async () => {
    const {
      catalog: { FINANCE_ASSET_CATALOG },
      mockData: { FINANCE_SYMBOLS },
    } = await loadFinanceModules();

    const catalogSymbols = Object.keys(FINANCE_ASSET_CATALOG);

    expect(new Set(catalogSymbols)).toEqual(new Set(FINANCE_SYMBOLS));
  });

  it("normalises tickers, venues, and currencies to uppercase", async () => {
    const {
      catalog: { FINANCE_ASSET_CATALOG },
    } = await loadFinanceModules();

    for (const metadata of Object.values(FINANCE_ASSET_CATALOG)) {
      // The seed script trims and uppercases each field before writing to Postgres;
      // mirroring those expectations here catches accidental regressions in the
      // static catalogue that would otherwise surface as duplicate keys.
      expect(metadata.symbol).toBe(metadata.symbol.toUpperCase());
      expect(metadata.exchange).toBe(metadata.exchange.toUpperCase());
      expect(metadata.currency).toBe(metadata.currency.toUpperCase());
    }
  });
});
