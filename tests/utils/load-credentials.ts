import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type PersistedCredentials = {
  readonly email: string;
  readonly password: string;
};

/**
 * Reasons why the credential cache needs to be regenerated. Exposed so callers
 * (such as the Playwright auth setup) can react accordingly by clearing stale
 * storage state or cookies when the underlying user changes.
 */
export type CredentialRegenerationReason =
  | "missing"
  | "empty"
  | "invalid_json"
  | "invalid_shape";

export type LoadCredentialsOptions = {
  /**
   * Invoked whenever a new credential pair is generated. Consumers typically
   * use the callback to clear stale Playwright storage state so retries do not
   * attempt to reuse a session that belongs to the previous user.
   */
  readonly onRegenerated?: (details: {
    readonly credentials: PersistedCredentials;
    readonly reason: CredentialRegenerationReason;
  }) => void;
};

/**
 * Directory that stores the Playwright automation credentials. The helper lives
 * under `tests/utils` to keep the path resolution consistent between the
 * Playwright setup worker and the unit tests that exercise the persistence
 * logic.
 */
export const AUTH_DIR = path.resolve(__dirname, "../.auth");

/** Absolute path to the JSON file storing the deterministic Playwright user. */
export const CREDENTIALS_PATH = path.join(AUTH_DIR, "user.json");

function generateCredentials(): PersistedCredentials {
  const email =
    process.env.E2E_USER_EMAIL ?? `e2e-${Date.now()}@playwright.com`;
  const password =
    process.env.E2E_USER_PASSWORD ?? `E2e-${randomBytes(6).toString("hex")}!`;

  return { email, password };
}

/**
 * Load the persisted Playwright credentials from disk or generate a fresh
 * record when the cache is missing or corrupted. The helper keeps the
 * automation bootstrap resilient to partial writes observed in CI where the
 * credential file may exist but contain an empty string.
 */
export function loadCredentials(
  options: LoadCredentialsOptions = {}
): PersistedCredentials {
  let regenerationReason: CredentialRegenerationReason | null = null;

  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
      if (raw.trim().length === 0) {
        regenerationReason = "empty";
        console.warn(
          "Detected empty Playwright credential cache; generating new credentials",
          { cachePath: CREDENTIALS_PATH }
        );
      } else {
        const parsed = JSON.parse(raw) as { email?: unknown; password?: unknown };
        if (typeof parsed.email === "string" && typeof parsed.password === "string") {
          return { email: parsed.email, password: parsed.password };
        }
        regenerationReason = "invalid_shape";
        console.warn(
          "Playwright credential cache missing required fields; generating new credentials",
          { cachePath: CREDENTIALS_PATH }
        );
      }
    } catch (error) {
      regenerationReason = "invalid_json";
      console.warn(
        "Failed to parse persisted Playwright credentials; generating a new pair",
        error instanceof Error ? { cachePath: CREDENTIALS_PATH, error } : undefined
      );
    }
  } else {
    regenerationReason = "missing";
  }

  const creds = generateCredentials();
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));

  if (regenerationReason) {
    options.onRegenerated?.({ credentials: creds, reason: regenerationReason });
  }

  return creds;
}
