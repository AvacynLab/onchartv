/**
 * Utilities for selecting the correct Pyodide runtime source depending on the
 * current execution environment.
 */
const REMOTE_PYODIDE_SRC = "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js";

/**
 * The hermetic Playwright suite cannot access the public internet. Serve a local
 * stub of the Pyodide runtime during end-to-end tests so the chat UI avoids
 * network requests while preserving the behaviour for development and
 * production.
 */
export const PLAYWRIGHT_PYODIDE_SRC = "/playwright/pyodide.js";

function isPlaywrightLikeEnvironment(env: NodeJS.ProcessEnv) {
  return (
    env.NEXT_PUBLIC_PLAYWRIGHT === "true" ||
    env.PLAYWRIGHT === "true" ||
    env.CI_PLAYWRIGHT === "true" ||
    Boolean(env.PLAYWRIGHT_TEST_BASE_URL)
  );
}

/**
 * Returns the script source that should be used to bootstrap the Pyodide
 * runtime. Playwright runs receive a local stub while every other environment
 * continues to load the official CDN bundle.
 */
export function getPyodideScriptSrc(
  env: NodeJS.ProcessEnv = process.env
): string {
  return isPlaywrightLikeEnvironment(env)
    ? PLAYWRIGHT_PYODIDE_SRC
    : REMOTE_PYODIDE_SRC;
}

export { REMOTE_PYODIDE_SRC };
