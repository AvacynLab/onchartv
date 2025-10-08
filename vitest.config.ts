import { availableParallelism } from "node:os";
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
 * Vitest spawns a worker per logical CPU by default. The full suite plus
 * coverage instrumentation can exceed the default Node.js heap limit on the
 * GitHub-hosted runners, so we clamp the worker pool to a conservative
 * maximum. We cap concurrency at two workers because coverage-enabled suites
 * routinely spike past the default 4 GB heap limit when more threads run in
 * parallel. The lower bound keeps reproducibility for single-core environments
 * while still allowing limited parallelism locally.
 */
const maxWorkerThreads = Math.max(1, Math.min(availableParallelism(), 2));

export default defineConfig({
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
    poolOptions: {
      threads: {
        /**
         * Limit concurrency to avoid exhausting the heap on CI while still
         * benefiting from multiple workers when resources allow.
         */
        maxThreads: maxWorkerThreads,
        minThreads: 1,
      },
    },
    /**
     * Emit human-readable output alongside a deterministic JUnit report so the
     * CI workflow can publish coverage and test telemetry without reruns.
     */
    reporters: [
      "default",
      ["junit", { outputFile: resolve(coverageDirectory, "junit.xml") }],
    ],
  },
});
