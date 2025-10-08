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
 * maximum. We fall back to a single worker whenever CI _or_ coverage
 * instrumentation is active to avoid the recurring OOMs observed on GitHub
 * runners. Locally (without coverage), we still allow up to two workers so
 * contributors retain a modest amount of parallelism.
 */
const isContinuousIntegration = process.env.CI === "true" ||
  process.env.GITHUB_ACTIONS === "true";
const isCoverageRun = process.env.VITEST_COVERAGE === "true";
const maxWorkerThreads = isContinuousIntegration || isCoverageRun
  ? 1
  : Math.max(1, Math.min(availableParallelism(), 2));

/**
 * Coverage runs retain instrumentation metadata for every executed module.
 * Switching Vitest to the "forks" pool while coverage is enabled ensures each
 * test file executes in its own short-lived child process so the OS can reclaim
 * memory immediately after the file completes. This avoids the cumulative heap
 * growth that previously exhausted a 12 GB limit on CI when we stayed on the
 * default worker-thread pool.
 */
const poolStrategy = isCoverageRun ? "forks" : "threads";

const threadPoolOptions = {
  threads: {
    /**
     * Limit concurrency to avoid exhausting the heap on CI while still
     * benefiting from multiple workers when resources allow.
     */
    maxThreads: maxWorkerThreads,
    minThreads: 1,
  },
} as const;

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
    pool: poolStrategy,
    ...(poolStrategy === "threads"
      ? { poolOptions: threadPoolOptions }
      : {}),
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
