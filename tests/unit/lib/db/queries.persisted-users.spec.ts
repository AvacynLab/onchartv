import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveCredentialsUser } from "@/lib/auth/credentials-verify";

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
    fileInitiallyExists = true,
  }: {
    records: PersistedUserRecord[];
    initialMtimeMs?: number;
    fileInitiallyExists?: boolean;
  }) {
    let currentPayload = JSON.stringify(records);
    let currentMtimeMs = initialMtimeMs;
    let isPersistedFilePresent = fileInitiallyExists;

    const applyFsMock = () => {
      /**
       * Provide the minimal subset of the Node `fs` module that the loader
       * interacts with. The default export mirrors the named shape so the
       * `import fs from "node:fs"` statement in `queries.ts` can resolve the
       * mocked helpers without tripping over Vitest's CJS emulation layer.
       */
      const mockedFs = {
        existsSync: vi.fn(() => isPersistedFilePresent),
        readFileSync: vi.fn(() => currentPayload),
        writeFileSync: vi.fn((_path: string, content: string) => {
          currentPayload = content;
          currentMtimeMs += 1;
          isPersistedFilePresent = true;
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
    };

    vi.stubEnv("PLAYWRIGHT", "true");
    vi.doMock("server-only", () => ({}));
    vi.doMock("node:fs", applyFsMock);

    const queries = await import("@/lib/db/queries");
    const store = queries.__getInMemoryStoreForTests();

    return {
      queries,
      store,
      setPersistedFilePresence(present: boolean) {
        isPersistedFilePresent = present;
      },
      /**
       * Reapply the filesystem mock while retaining the captured payload so we
       * can simulate additional module graphs that reuse the persisted
       * snapshot. Turbopack frequently reloads modules under Playwright, so the
       * helper mirrors that behaviour for the unit assertions.
       */
      reloadQueries: async (options?: { resetProcessStore?: boolean }) => {
        vi.resetModules();
        vi.stubEnv("PLAYWRIGHT", "true");
        vi.doMock("server-only", () => ({}));
        vi.doMock("node:fs", applyFsMock);
        if (options?.resetProcessStore ?? false) {
          // @ts-expect-error -- Explicitly mutate the process-scoped cache to
          // emulate an isolated module graph such as a NextAuth handler.
          delete (process as { __ONCHARTV_IN_MEMORY_STORE__?: unknown })
            .__ONCHARTV_IN_MEMORY_STORE__;
          // eslint-disable-next-line no-undef -- `globalThis` is available in the test runtime.
          delete (globalThis as { __ONCHARTV_IN_MEMORY_STORE__?: unknown })
            .__ONCHARTV_IN_MEMORY_STORE__;
        }
        return import("@/lib/db/queries");
      },
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

  it("retains credential verification after a module reload", async () => {
    const email = "reloaded@example.com";
    const password = "strong-password!";

    const { queries, reloadQueries } = await setup({
      records: [],
      initialMtimeMs: 20,
    });

    await queries.createUser(email, password);

    const dependencies = {
      getUser: queries.getUser,
      createUser: queries.createUser,
      getTestUserPlaintextPassword: queries.getTestUserPlaintextPassword,
    } satisfies Parameters<typeof resolveCredentialsUser>[2];

    expect(
      await resolveCredentialsUser(email, password, dependencies)
    ).not.toBeNull();

    const reloadedQueries = await reloadQueries({ resetProcessStore: true });

    const reloadedDependencies = {
      getUser: reloadedQueries.getUser,
      createUser: reloadedQueries.createUser,
      getTestUserPlaintextPassword: reloadedQueries.getTestUserPlaintextPassword,
    } satisfies Parameters<typeof resolveCredentialsUser>[2];

    const resolved = await resolveCredentialsUser(
      email,
      password,
      reloadedDependencies
    );

    expect(resolved?.email).toBe(email);
  });

  it("hydrates NextAuth stores when the snapshot appears after initialisation", async () => {
    const email = "late-load@example.com";
    const password = "reliable-password!";

    const { queries, reloadQueries } = await setup({
      records: [],
      initialMtimeMs: 0,
      fileInitiallyExists: false,
    });

    const authDependencies = {
      getUser: queries.getUser,
      createUser: queries.createUser,
      getTestUserPlaintextPassword: queries.getTestUserPlaintextPassword,
    } satisfies Parameters<typeof resolveCredentialsUser>[2];

    const writerQueries = await reloadQueries({ resetProcessStore: true });
    await writerQueries.createUser(email, password);

    const resolved = await resolveCredentialsUser(
      email,
      password,
      authDependencies
    );

    expect(resolved?.email).toBe(email);
  });
});
