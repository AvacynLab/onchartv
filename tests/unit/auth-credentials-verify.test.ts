import assert from "node:assert/strict";
import test from "node:test";

import { resolveCredentialsUser } from "../../lib/auth/credentials-verify";
import { generateHashedPassword } from "../../lib/db/utils";

test("resolveCredentialsUser returns null when the user does not exist", async () => {
  const overrides = {
    getUser: async () =>
      [] as Array<{ id: string; email: string; password: string | null }>,
    createUser: async () => {},
    getTestUserPlaintextPassword: () => undefined as string | undefined,
  };

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
  };

  const result = await resolveCredentialsUser(email, password, overrides);

  assert.equal(createUserCalls, 1, "createUser should refresh the stored hash");
  assert.equal(getUserCalls, 2, "credentials helper should re-read the user after refresh");
  assert.equal(result?.password, refreshedHash);
});

test("resolveCredentialsUser returns null when plaintext fallback does not match", async () => {
  const email = "user@example.com";
  const password = "secret";
  const staleHash = generateHashedPassword("old-secret");

  const overrides = {
    getUser: async () => [{ id: "user-id", email, password: staleHash } as any],
    createUser: async () => {
      throw new Error("createUser should not be called");
    },
    getTestUserPlaintextPassword: () => "different",
  };

  const result = await resolveCredentialsUser(email, password, overrides);

  assert.equal(result, null);
});

test("resolveCredentialsUser prefers the provided dependency overrides", async () => {
  const email = "override@example.com";
  const password = "secret";
  const hash = generateHashedPassword(password);

  let getUserCalls = 0;
  let createUserCalls = 0;
  let plaintextLookupCalls = 0;

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
  };

  const result = await resolveCredentialsUser(email, password, overrides);

  assert.equal(result?.email, email);
  assert.equal(getUserCalls, 1);
  assert.equal(createUserCalls, 0);
  assert.equal(plaintextLookupCalls, 0);
});
