import { compare } from "bcrypt-ts";

import { DUMMY_PASSWORD } from "@/lib/constants";
import type { User } from "@/lib/db/schema";

async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  /**
   * Always rely on the asynchronous bcrypt comparison so production, local
   * development and the hermetic Playwright runs evaluate credentials using the
   * same implementation. The async helper mirrors the work performed by
   * NextAuth and avoids subtle divergences caused by Turbopack recompilations
   * swapping in the sync variant mid-test.
   */
  return compare(password, hashedPassword);
}

/**
 * Resolve the persisted user associated with the provided credentials.
 *
 * The helper mirrors the logic executed by the credentials provider while
 * allowing unit tests to exercise the edge cases (stale bcrypt hashes during
 * module reloads, for example) without instantiating a full NextAuth runtime.
 */
type CredentialsDependencies = {
  getUser: typeof import("@/lib/db/queries")["getUser"];
  createUser: typeof import("@/lib/db/queries")["createUser"];
  getTestUserPlaintextPassword: typeof import("@/lib/db/queries")["getTestUserPlaintextPassword"];
};

async function resolveDependencies(
  overrides?: Partial<CredentialsDependencies>
): Promise<CredentialsDependencies> {
  if (
    overrides?.getUser &&
    overrides?.createUser &&
    overrides?.getTestUserPlaintextPassword
  ) {
    return overrides as CredentialsDependencies;
  }

  const queries = await import("@/lib/db/queries");

  return {
    getUser: overrides?.getUser ?? queries.getUser,
    createUser: overrides?.createUser ?? queries.createUser,
    getTestUserPlaintextPassword:
      overrides?.getTestUserPlaintextPassword ??
      queries.getTestUserPlaintextPassword,
  } satisfies CredentialsDependencies;
}

export async function resolveCredentialsUser(
  email: string,
  password: string,
  overrides?: Partial<CredentialsDependencies>
): Promise<User | null> {
  const { getUser, createUser, getTestUserPlaintextPassword } =
    await resolveDependencies(overrides);

  const users = await getUser(email);

  if (users.length === 0) {
    /**
     * Match the timing characteristics of a failed lookup by still hashing the
     * candidate password. This mirrors the mitigation applied by NextAuth's
     * default adapter and keeps the observable timing behaviour consistent
     * between successful and failed attempts.
     */
    await compare(password, DUMMY_PASSWORD);
    return null;
  }

  const [user] = users;

  if (!user?.password) {
    await compare(password, DUMMY_PASSWORD);
    return null;
  }

  if (await verifyPassword(password, user.password)) {
    return user;
  }

  const plaintextPassword = getTestUserPlaintextPassword(email);

  if (!plaintextPassword || plaintextPassword !== password) {
    return null;
  }

  /**
   * Playwright keeps the in-memory store alive across module reloads. When a
   * reload occurs while a registration is in flight the bcrypt hash stored for
   * the test account may become stale. Refresh the stored credentials and read
   * the user back so downstream consumers receive the up-to-date record.
   */
  await createUser(email, password);

  const [refreshedUser] = await getUser(email);

  if (!refreshedUser?.password) {
    await compare(password, DUMMY_PASSWORD);
    return null;
  }

  return refreshedUser;
}

export const __test = { verifyPassword };
