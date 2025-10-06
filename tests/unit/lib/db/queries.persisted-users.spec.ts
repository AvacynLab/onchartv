import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Minimal representation of the persisted Playwright credential snapshot. The
 * unit tests feed deterministic payloads through the mocked filesystem so we
 * can validate how the loader reacts to timestamp changes without hitting the
 * real disk.
 */
type PersistedUserRecord = {
  id: string;
  email: string;
  password: string;
  plaintext?: string;
};

describe("loadPersistedUsers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function setup({
    records,
    initialMtimeMs = 1,
  }: {
    records: PersistedUserRecord[];
    initialMtimeMs?: number;
  }) {
    let currentPayload = JSON.stringify(records);
    let currentMtimeMs = initialMtimeMs;

    vi.stubEnv("PLAYWRIGHT", "true");
    vi.doMock("server-only", () => ({}));
    vi.doMock("node:fs", () => {
      /**
       * Provide the minimal subset of the Node `fs` module that the loader
       * interacts with. The default export mirrors the named shape so the
       * `import fs from "node:fs"` statement in `queries.ts` can resolve the
       * mocked helpers without tripping over Vitest's CJS emulation layer.
       */
      const mockedFs = {
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() => currentPayload),
        writeFileSync: vi.fn((_path: string, content: string) => {
          currentPayload = content;
          currentMtimeMs += 1;
        }),
        mkdirSync: vi.fn(),
        rmSync: vi.fn(),
        statSync: vi.fn(() => ({ mtimeMs: currentMtimeMs })),
      } satisfies Partial<typeof import("node:fs")> & {
        existsSync: ReturnType<typeof vi.fn>;
        readFileSync: ReturnType<typeof vi.fn>;
        writeFileSync: ReturnType<typeof vi.fn>;
        mkdirSync: ReturnType<typeof vi.fn>;
        rmSync: ReturnType<typeof vi.fn>;
        statSync: ReturnType<typeof vi.fn>;
      };

      return {
        ...mockedFs,
        default: mockedFs,
      };
    });

    const queries = await import("@/lib/db/queries");
    const store = queries.__getInMemoryStoreForTests();

    return {
      queries,
      store,
      updatePersistedRecords(
        nextRecords: PersistedUserRecord[],
        options?: { bumpMtime?: boolean }
      ) {
        currentPayload = JSON.stringify(nextRecords);
        if (options?.bumpMtime ?? true) {
          currentMtimeMs += 1;
        }
      },
    };
  }

  it("reloads persisted users when the snapshot timestamp increases", async () => {
    const { queries, store, updatePersistedRecords } = await setup({
      records: [
        {
          id: "user-1",
          email: "first@example.com",
          password: "$hashed-1",
          plaintext: "secret-1",
        },
      ],
      initialMtimeMs: 5,
    });

    expect(store.userPlaintextByEmail.get("first@example.com")).toBe("secret-1");

    updatePersistedRecords(
      [
        {
          id: "user-1",
          email: "first@example.com",
          password: "$hashed-1",
          plaintext: "updated-secret",
        },
        {
          id: "user-2",
          email: "second@example.com",
          password: "$hashed-2",
          plaintext: "secret-2",
        },
      ]
    );

    queries.__loadPersistedUsersForTests(store);

    expect(store.userPlaintextByEmail.get("first@example.com")).toBe(
      "updated-secret"
    );
    expect(store.userPlaintextByEmail.get("second@example.com")).toBe(
      "secret-2"
    );
  });

  it("skips hydration when the persisted snapshot timestamp is unchanged", async () => {
    const { queries, store, updatePersistedRecords } = await setup({
      records: [
        {
          id: "user-1",
          email: "first@example.com",
          password: "$hashed-1",
          plaintext: "secret-1",
        },
      ],
      initialMtimeMs: 10,
    });

    expect(store.userPlaintextByEmail.get("first@example.com")).toBe("secret-1");

    updatePersistedRecords(
      [
        {
          id: "user-1",
          email: "first@example.com",
          password: "$hashed-1",
          plaintext: "stale",
        },
      ],
      { bumpMtime: false }
    );

    queries.__loadPersistedUsersForTests(store);

    expect(store.userPlaintextByEmail.get("first@example.com")).toBe("secret-1");
  });
});
