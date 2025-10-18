import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  AUTH_DIR,
  CREDENTIALS_PATH,
  loadCredentials,
  type PersistedCredentials,
} from "../../utils/load-credentials";

const STATE_PATH = path.join(AUTH_DIR, "state.json");

/**
 * Snapshot the credential cache so the suite can mutate and restore it without
 * breaking the Playwright setup worker. When the cache is missing we synthesise
 * an empty baseline so the restoration step simply removes the generated file.
 */
function snapshotCredentialCache(): {
  readonly originalCredentials: PersistedCredentials | null;
  readonly originalFileContent: string | null;
} {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    return {
      originalCredentials: null,
      originalFileContent: null,
    };
  }

  const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw) as PersistedCredentials;
    return {
      originalCredentials: parsed,
      originalFileContent: raw,
    };
  } catch (error) {
    throw new Error(
      "Existing Playwright credential cache is not valid JSON; aborting resilience test",
      error instanceof Error ? { cause: error } : undefined
    );
  }
}

/**
 * Restore the credential cache to its initial state so subsequent tests reuse
 * the same automation account provisioned by the setup worker.
 */
function restoreCredentialCache(
  baseline: ReturnType<typeof snapshotCredentialCache>
) {
  if (baseline.originalFileContent === null) {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      fs.rmSync(CREDENTIALS_PATH, { force: true });
    }
    return;
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, baseline.originalFileContent);
}

/**
 * Ensure the automation state snapshot remains consistent after the resilience
 * check. When we regenerate credentials we want Playwright to discard the
 * obsolete storage state, otherwise the stale session cookies would fail to
 * authenticate the new account.
 */
function resetStorageStateSnapshot() {
  if (fs.existsSync(STATE_PATH)) {
    fs.rmSync(STATE_PATH, { force: true });
  }
}

/**
 * The resilience test deliberately corrupts the persisted credentials and
 * asserts that the helper regenerates them using the fallback environment
 * variables. The regeneration should also rewrite the cache on disk so the
 * setup worker can provision the matching automation account during the next
 * run.
 */
test.describe("Playwright credential resilience", () => {
  test("rebuilds the automation credentials after detecting corrupted JSON", async () => {
    const baseline = snapshotCredentialCache();

    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      fs.writeFileSync(CREDENTIALS_PATH, "{not-json");

      const fallbackEmail =
        baseline.originalCredentials?.email ?? "corrupted-playwright@example.com";
      const fallbackPassword =
        baseline.originalCredentials?.password ?? "Corrupted123!";

      process.env.E2E_USER_EMAIL = fallbackEmail;
      process.env.E2E_USER_PASSWORD = fallbackPassword;

      resetStorageStateSnapshot();

      const credentials = loadCredentials();

      expect(credentials).toEqual({
        email: fallbackEmail,
        password: fallbackPassword,
      });

      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(String(warnings[0]?.[0])).toContain(
        "Failed to parse persisted Playwright credentials"
      );

      const persisted = JSON.parse(
        fs.readFileSync(CREDENTIALS_PATH, "utf-8")
      ) as PersistedCredentials;
      expect(persisted).toEqual(credentials);
    } finally {
      restoreCredentialCache(baseline);
      delete process.env.E2E_USER_EMAIL;
      delete process.env.E2E_USER_PASSWORD;
      console.warn = originalWarn;
    }
  });
});
