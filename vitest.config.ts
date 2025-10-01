import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Resolve the project root so Vitest matches the Next.js path aliases ("@/").
 * Using `fileURLToPath` keeps the configuration compatible with ESM modules.
 */
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

/**
 * Deterministic output location for machine-readable Vitest telemetry.
 * The CI workflow uploads the folder so dashboards can surface coverage
 * and test regressions without rerunning the suite locally.
 */
const coverageDirectory = resolve(projectRoot, "coverage");

/**
 * Lazily import the JUnit reporter to keep the configuration compatible with
 * Node's CommonJS loader that Vitest uses when bundling the config file.
 */
async function loadReporters() {
  const { JUnitReporter } = await import("vitest/reporters");

  return [
    "default",
    new JUnitReporter({
      outputFile: resolve(coverageDirectory, "junit.xml"),
    }),
  ] as const;
}

export default defineConfig(async () => ({
  resolve: {
    alias: {
      "@": resolve(projectRoot, "."),
    },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["tests/unit/components/**/*.spec.tsx", "jsdom"],
      ["tests/unit/settings/**/*.spec.tsx", "jsdom"],
    ],
    globals: true,
    include: ["tests/unit/**/*.spec.ts", "tests/unit/**/*.spec.tsx"],
    exclude: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: coverageDirectory,
      reporter: ["text", "lcov"],
    },
    reporters: await loadReporters(),
  },
}));
