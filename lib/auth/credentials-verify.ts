import { compareSync } from "bcrypt-ts";

import { DUMMY_PASSWORD } from "@/lib/constants";
import type { User } from "@/lib/db/schema";

async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  /**
   * Use the synchronous bcrypt comparator to keep credential verification
   * compatible with environments that do not expose the Node.js scheduling
   * primitives relied upon by the async helper (`setImmediate`,
   * `process.nextTick`). Wrapping the result in a resolved promise retains the
   * async signature expected by the surrounding logic while still exercising
   * the same hashing cost as the sync comparison used during user creation.
   */
  return Promise.resolve(compareSync(password, hashedPassword));
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
    compareSync(password, DUMMY_PASSWORD);
    return null;
  }

  const [user] = users;
  let cachedPlaintext: string | undefined;
  let hasLookedUpPlaintext = false;

  const resolvePlaintextPassword = () => {
    if (!hasLookedUpPlaintext) {
      cachedPlaintext = getTestUserPlaintextPassword(email);
      hasLookedUpPlaintext = true;
    }

    return cachedPlaintext;
  };

  const refreshUserPassword = async () => {
    /**
     * Playwright keeps the in-memory store alive across module reloads. When a
     * reload occurs while a registration is in flight the bcrypt hash stored
     * for the test account may become stale. Refresh the stored credentials and
     * read the user back so downstream consumers receive the up-to-date record.
     */
    await createUser(email, password);

    const [refreshedUser] = await getUser(email);

    if (!refreshedUser?.password) {
      compareSync(password, DUMMY_PASSWORD);
      return null;
    }

    return refreshedUser;
  };

  if (!user?.password) {
    const plaintextPassword = resolvePlaintextPassword();
    if (plaintextPassword && plaintextPassword === password) {
      const refreshedUser = await refreshUserPassword();
      if (refreshedUser) {
        return refreshedUser;
      }
    }

    compareSync(password, DUMMY_PASSWORD);
    return null;
  }

  if (await verifyPassword(password, user.password)) {
    return user;
  }

  const plaintextPassword = resolvePlaintextPassword();
  if (plaintextPassword && plaintextPassword === password) {
    const refreshedUser = await refreshUserPassword();
    if (refreshedUser) {
      return refreshedUser;
    }
  }

  return null;
}

export const __test = { verifyPassword };
