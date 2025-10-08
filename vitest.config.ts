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
/**
 * The coverage shards produce a consolidated JUnit report for CI. When the
 * React component suites execute without coverage we disable the reporter to
 * avoid overwriting the earlier artifact with the reduced subset of tests.
 */
const shouldEmitJUnit = process.env.VITEST_JUNIT !== "false";
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

const forkPoolOptions = {
  forks: {
    /**
     * Force coverage runs onto a single forked process at a time. Vitest's
     * default of spawning one child per CPU still leads to overlapping
     * coverage-instrumented processes which collectively exceed the expanded
     * 12 GB heap limit on CI. Serialising fork execution keeps memory usage
     * bounded without sacrificing hermetic isolation between tests.
     */
    maxForks: 1,
    minForks: 1,
    /**
     * Disable worker reuse so each test file runs in a fresh child process.
     * The Vitest runner otherwise retains coverage-instrumented modules in a
     * long-lived worker, and the cumulative heap growth still crashes the
     * suite even with a 16 GB limit. Forking per file gives the OS a chance to
     * reclaim memory before the next test executes.
     */
    reuseWorkers: false,
  },
} as const;

const poolOptions = poolStrategy === "threads" ? threadPoolOptions : forkPoolOptions;

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
      /**
       * Only instrument the server-side code that our Vitest suite exercises.
       * Constraining coverage to API route handlers and the shared libraries
       * they depend on avoids touching the massive Next.js client surface while
       * still giving CI meaningful insights into back-end regressions.
       */
      include: [
        "lib/**/*.ts",
        "lib/**/*.mts",
        "lib/**/*.cts",
        "app/**/api/**/*.ts",
        "app/**/api/**/*.mts",
        "app/**/api/**/*.cts",
      ],
      exclude: [
        "public/**",
        "scripts/**",
        "tests/**",
      ],
      /**
       * Preserve coverage artifacts between sharded runs so the sequential
       * invocations in `scripts/run-vitest.mjs` can merge their results into a
       * single report.
       */
      cleanOnRerun: false,
    },
    pool: poolStrategy,
    poolOptions,
    /**
     * Emit human-readable output alongside a deterministic JUnit report so the
     * CI workflow can publish coverage and test telemetry without reruns.
     */
    reporters: shouldEmitJUnit
      ? [
        "default",
        ["junit", { outputFile: resolve(coverageDirectory, "junit.xml") }],
      ]
      : ["default"],
  },
});
