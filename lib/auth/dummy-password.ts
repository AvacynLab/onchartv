import { generateDummyPassword } from "@/lib/db/utils";

/**
 * Resolve the bcrypt hash used to mitigate timing attacks when credential
 * verification fails. The helper memoises the computed value so subsequent
 * callers reuse the same hash without incurring additional bcrypt rounds.
 */
let cachedDummyPassword: string | null = null;

export function getDummyPassword(): string {
  if (cachedDummyPassword) {
    return cachedDummyPassword;
  }

  cachedDummyPassword = generateDummyPassword();
  return cachedDummyPassword;
}
