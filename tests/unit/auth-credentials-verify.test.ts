import assert from "node:assert/strict";
import test from "node:test";

import { generateHashedPassword } from "../../lib/db/utils";

process.env.PLAYWRIGHT = process.env.PLAYWRIGHT ?? "true";

async function loadCredentialsModule() {
  return await import("../../lib/auth/credentials-verify");
}

test("resolveCredentialsUser returns null when the user does not exist", async () => {
  const { resolveCredentialsUser } = await loadCredentialsModule();

  const overrides = {
    getUser: async () =>
      [] as Array<{ id: string; email: string; password: string | null }>,
    createUser: async () => {},
    getTestUserPlaintextPassword: () => undefined as string | undefined,
  } satisfies Parameters<typeof resolveCredentialsUser>[2];

  const result = await resolveCredentialsUser(
    "missing@example.com",
    "secret",
    overrides
  );

  assert.equal(result, null);
});

test("resolveCredentialsUser refreshes stale hashes when plaintext matches", async () => {
  const email = "user@example.com";
  const password = "secret";
  const staleHash = generateHashedPassword("old-secret");
  const refreshedHash = generateHashedPassword(password);

  let getUserCalls = 0;
  let createUserCalls = 0;

  const { resolveCredentialsUser } = await loadCredentialsModule();

  const overrides = {
    getUser: async () => {
      getUserCalls += 1;
      return getUserCalls === 1
        ? [{ id: "user-id", email, password: staleHash } as any]
        : [{ id: "user-id", email, password: refreshedHash } as any];
    },
    createUser: async () => {
      createUserCalls += 1;
    },
    getTestUserPlaintextPassword: () => password,
  } satisfies Parameters<typeof resolveCredentialsUser>[2];

  const result = await resolveCredentialsUser(email, password, overrides);

  assert.equal(createUserCalls, 1, "createUser should refresh the stored hash");
  assert.equal(
    getUserCalls,
    2,
    "credentials helper should re-read the user after refresh"
  );
  assert.equal(result?.password, refreshedHash);
});

test("resolveCredentialsUser returns null when plaintext fallback does not match", async () => {
  const email = "user@example.com";
  const password = "secret";
  const staleHash = generateHashedPassword("old-secret");

  const { resolveCredentialsUser } = await loadCredentialsModule();

  const overrides = {
    getUser: async () => [{ id: "user-id", email, password: staleHash } as any],
    createUser: async () => {
      throw new Error("createUser should not be called");
    },
    getTestUserPlaintextPassword: () => "different",
  } satisfies Parameters<typeof resolveCredentialsUser>[2];

  const result = await resolveCredentialsUser(email, password, overrides);

  assert.equal(result, null);
});

test(
  "resolveCredentialsUser creates a user in test environments when missing",
  async () => {
    const email = "missing@example.com";
    const password = "secret";
    const hashedPassword = generateHashedPassword(password);

    let getUserCalls = 0;
    let createUserCalls = 0;

    const { resolveCredentialsUser } = await loadCredentialsModule();

    const overrides = {
      getUser: async () => {
        getUserCalls += 1;
        return getUserCalls === 1
          ? []
          : [{ id: "created-id", email, password: hashedPassword } as any];
      },
      createUser: async () => {
        createUserCalls += 1;
      },
      getTestUserPlaintextPassword: () => undefined,
    } satisfies Parameters<typeof resolveCredentialsUser>[2];

    const result = await resolveCredentialsUser(email, password, overrides);

    assert.equal(createUserCalls, 1);
    assert.equal(getUserCalls >= 2, true);
    assert.equal(result?.email, email);
  }
);

test("resolveCredentialsUser prefers the provided dependency overrides", async () => {
  const email = "override@example.com";
  const password = "secret";
  const hash = generateHashedPassword(password);

  let getUserCalls = 0;
  let createUserCalls = 0;
  let plaintextLookupCalls = 0;

  const { resolveCredentialsUser } = await loadCredentialsModule();

  const overrides = {
    getUser: async () => {
      getUserCalls += 1;
      return [{ id: "user-id", email, password: hash } as any];
    },
    createUser: async () => {
      createUserCalls += 1;
    },
    getTestUserPlaintextPassword: () => {
      plaintextLookupCalls += 1;
      return undefined;
    },
  } satisfies Parameters<typeof resolveCredentialsUser>[2];

  const result = await resolveCredentialsUser(email, password, overrides);

  assert.equal(result?.email, email);
  assert.equal(getUserCalls, 1);
  assert.equal(createUserCalls, 0);
  assert.equal(plaintextLookupCalls, 0);
});

test(
  "resolveCredentialsUser returns existing user when plaintext matches in test env",
  async () => {
    const email = "user@example.com";
    const password = "secret";
    const staleHash = generateHashedPassword("old-secret");

    let refreshAttempts = 0;

    const { resolveCredentialsUser } = await loadCredentialsModule();

    const overrides = {
      getUser: async () => [{ id: "user-id", email, password: staleHash } as any],
      createUser: async () => {
        refreshAttempts += 1;
        throw new Error("refresh should not be required when plaintext matches");
      },
      getTestUserPlaintextPassword: () => password,
    } satisfies Parameters<typeof resolveCredentialsUser>[2];

    const result = await resolveCredentialsUser(email, password, overrides);

    assert.equal(refreshAttempts, 1);
    assert.equal(result?.email, email);
  }
);
