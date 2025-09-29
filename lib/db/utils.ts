import { generateId } from "ai";
import { genSaltSync, hashSync } from "bcrypt-ts";

/**
 * Detect whether we are running inside one of the hermetic Playwright
 * environments. Those runs set at least one of the following environment
 * variables so we can fall back to faster password hashing while keeping the
 * production defaults untouched.
 */
const isHermeticTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

/**
 * bcrypt salt rounds applied to password hashes. The deterministic Playwright
 * suite exercises registration and login dozens of times, so using the
 * production cost factor (10) would add multiple minutes to every run. We lower
 * the cost to four rounds when the hermetic flag is active, which keeps the
 * hashes compatible with the credentials provider while dramatically speeding
 * up the tests.
 */
const BCRYPT_SALT_ROUNDS = isHermeticTestEnvironment ? 4 : 10;

export function generateHashedPassword(password: string) {
  /**
   * Generate a new bcrypt salt using the environment-aware cost factor before
   * hashing the password. Tests rely on the smaller salt rounds to keep the
   * registration setup within a few seconds while production still benefits
   * from the stronger default.
   */
  const salt = genSaltSync(BCRYPT_SALT_ROUNDS);
  const hash = hashSync(password, salt);

  return hash;
}

export function generateDummyPassword() {
  /**
   * Generate a hashed throwaway password used to mitigate timing attacks when
   * credential verification fails. The helper relies on the same environment-
   * aware bcrypt cost so the fallback path matches the behaviour exercised by
   * the regular hashing helper.
   */
  const password = generateId();
  const hashedPassword = generateHashedPassword(password);

  return hashedPassword;
}
