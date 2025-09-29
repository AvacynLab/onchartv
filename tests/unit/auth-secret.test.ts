/**
 * Coverage for the authentication secret resolver. These assertions make sure
 * development and Playwright environments keep working without manual
 * `AUTH_SECRET` configuration while production still requires an explicit
 * secret before booting NextAuth.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  NON_PRODUCTION_AUTH_SECRET,
  resolveAuthSecret,
} from "../../lib/auth/secret";

test("prefers explicit AUTH_SECRET values when available", () => {
  const env = {
    AUTH_SECRET: "custom-secret",
    NODE_ENV: "development",
  } as NodeJS.ProcessEnv;

  assert.equal(
    resolveAuthSecret(env),
    "custom-secret",
    "The helper must return the configured AUTH_SECRET when present",
  );
});

test("falls back to the deterministic secret during local development", () => {
  const env = {
    NODE_ENV: "development",
  } as NodeJS.ProcessEnv;

  assert.equal(
    resolveAuthSecret(env),
    NON_PRODUCTION_AUTH_SECRET,
    "Development environments should reuse the deterministic fallback secret",
  );
});

test("enables Playwright runs even when NODE_ENV is production", () => {
  const env = {
    NODE_ENV: "production",
    PLAYWRIGHT: "true",
  } as NodeJS.ProcessEnv;

  assert.equal(
    resolveAuthSecret(env),
    NON_PRODUCTION_AUTH_SECRET,
    "Playwright flags must unlock the deterministic secret for hermetic tests",
  );
});

test("throws when production instances are missing a configured secret", () => {
  const env = {
    NODE_ENV: "production",
  } as NodeJS.ProcessEnv;

  assert.throws(
    () => resolveAuthSecret(env),
    /Missing AUTH_SECRET/,
    "Production environments should require a configured authentication secret",
  );
});
