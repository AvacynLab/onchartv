import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type MockedCatalogEntry = {
  symbol: string;
  exchange: string;
  name: string;
  currency: string;
  type: "equity" | "crypto" | "fx";
};

const originalEnv = { ...process.env };

/**
 * Injects a fake finance catalogue for the current test run. The seed script
 * reads directly from the module export, so we replace it with deterministic
 * fixtures before importing the implementation under test.
 */
const mockFinanceCatalog = (entries: Record<string, MockedCatalogEntry>) => {
  vi.doMock("@/lib/finance/catalog", () => ({
    FINANCE_ASSET_CATALOG: entries,
  }));
};

/**
 * Stubs the Drizzle/Postgres dependencies so we can assert the interactions
 * performed by the seed script without touching a real database.
 */
const mockDatabaseLayer = () => {
  const runMigrate = vi.fn().mockResolvedValue(undefined);
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const transaction = vi
    .fn()
    .mockImplementation(async (callback: (tx: { insert: typeof insert }) => Promise<void>) => {
      await callback({ insert });
    });
  const end = vi.fn().mockResolvedValue(undefined);
  const drizzle = vi.fn(() => ({ transaction }));
  const postgresFactory = vi.fn(() => ({ transaction, end }));

  vi.doMock("@/lib/db/migrate", () => ({ runMigrate }));
  vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle }));
  vi.doMock("postgres", () => ({
    __esModule: true,
    default: postgresFactory,
  }));

  return {
    runMigrate,
    onConflictDoUpdate,
    values,
    insert,
    transaction,
    end,
    drizzle,
    postgresFactory,
  };
};

describe("seedDatabase", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv, POSTGRES_URL: "postgres://example" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("runs migrations and upserts the normalised finance catalogue", async () => {
    mockFinanceCatalog({
      NVDA: {
        symbol: "NVDA",
        exchange: "nasdaq",
        name: "NVIDIA Corporation",
        currency: "usd",
        type: "equity",
      },
      BTCUSD: {
        symbol: "BTCUSD",
        exchange: "coinbase",
        name: "Bitcoin / US Dollar",
        currency: "usd",
        type: "crypto",
      },
      AAPL: {
        symbol: "AAPL",
        exchange: " Nasdaq ",
        name: "Apple Inc.",
        currency: "usd",
        type: "equity",
      },
      EURUSD: {
        symbol: "EURUSD",
        exchange: "OANDA",
        name: "Euro / US Dollar",
        currency: "usd",
        type: "fx",
      },
      ETHUSD: {
        symbol: "ETHUSD",
        exchange: "COINBASE",
        name: "Ethereum / US Dollar",
        currency: "usd",
        type: "crypto",
      },
    });

    const mocks = mockDatabaseLayer();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      const { seedDatabase } = await import("@/lib/db/seed");

      await seedDatabase();

      expect(mocks.runMigrate).toHaveBeenCalledOnce();
      expect(mocks.runMigrate.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.transaction.mock.invocationCallOrder[0]!
      );
      expect(mocks.values).toHaveBeenCalledTimes(5);

      const insertedSymbols = mocks.values.mock.calls.map((call) => call[0]!.symbol);
      expect(insertedSymbols).toEqual([
        "AAPL",
        "BTCUSD",
        "ETHUSD",
        "EURUSD",
        "NVDA",
      ]);

      expect(mocks.values).toHaveBeenCalledWith({
        symbol: "AAPL",
        exchange: "NASDAQ",
        type: "equity",
        name: "Apple Inc.",
        currency: "USD",
      });

      expect(mocks.values).toHaveBeenCalledWith({
        symbol: "NVDA",
        exchange: "NASDAQ",
        type: "equity",
        name: "NVIDIA Corporation",
        currency: "USD",
      });

      expect(mocks.onConflictDoUpdate).toHaveBeenCalledTimes(5);
      expect(mocks.end).toHaveBeenCalledWith({ timeout: 5 });
      expect(infoSpy).toHaveBeenCalledWith(
        "[db:seed] Inserted 5 finance assets into the catalogue."
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  /**
   * The catalogue must include the four instruments referenced by the
   * Playwright finance fixtures; otherwise the seed would diverge from the
   * intercepted APIs and break end-to-end runs.
   */
  it("throws when the offline catalogue misses required Playwright fixtures", async () => {
    mockFinanceCatalog({
      AAPL: {
        symbol: "AAPL",
        exchange: "NASDAQ",
        name: "Apple Inc.",
        currency: "USD",
        type: "equity",
      },
    });

    const mocks = mockDatabaseLayer();

    const { seedDatabase } = await import("@/lib/db/seed");

    await expect(seedDatabase()).rejects.toThrowError(
      /Missing required finance seed asset\(s\): NVDA, BTCUSD, EURUSD/
    );
    expect(mocks.runMigrate).not.toHaveBeenCalled();
    expect(mocks.postgresFactory).not.toHaveBeenCalled();
  });
});
