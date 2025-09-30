import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance/catalog", () => ({
  FINANCE_ASSET_CATALOG: {
    AAPL: {
      symbol: "AAPL",
      exchange: "NASDAQ",
      name: "Apple Inc.",
      currency: "USD",
      type: "equity",
    },
  },
}));

describe("seedDatabase", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv, POSTGRES_URL: "postgres://example" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("runs migrations before inserting finance catalogue assets", async () => {
    const runMigrate = vi.fn().mockResolvedValue(undefined);

    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });

    const transaction = vi.fn(async (callback: (tx: { insert: typeof insert }) => unknown) => {
      await callback({ insert });
    });

    const end = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/db/migrate", () => ({ runMigrate }));
    vi.doMock("drizzle-orm/postgres-js", () => ({
      drizzle: vi.fn(() => ({ transaction })),
    }));
    vi.doMock("postgres", () => ({
      __esModule: true,
      default: vi.fn(() => ({ transaction, end })),
    }));

    const { seedDatabase } = await import("@/lib/db/seed");

    await seedDatabase();

    expect(runMigrate).toHaveBeenCalledOnce();
    expect(runMigrate.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0]!
    );
    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalled();
    expect(onConflictDoUpdate).toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith({ timeout: 5 });
  });
});
