#!/usr/bin/env node
/**
 * Ensure Vitest runs with an expanded heap size so coverage-enabled runs avoid
 * the 4 GB default limit that repeatedly triggered OOM failures on CI.
 */
import { spawnSync } from "node:child_process";

/** Desired heap size (in megabytes) for coverage-heavy Vitest runs. */
const DESIRED_HEAP_MB = 17408;

const env = { ...process.env };
const existingNodeOptions = env.NODE_OPTIONS ?? "";
const heapFlag = `--max-old-space-size=${DESIRED_HEAP_MB}`;

// Only append the heap flag when the caller has not already specified one.
if (!existingNodeOptions.includes("--max-old-space-size")) {
  env.NODE_OPTIONS = `${existingNodeOptions} ${heapFlag}`.trim();
}

/**
 * Determine whether Vitest is already installed locally. If not, fall back to
 * `pnpm dlx` so contributors without a full install can still invoke the suite.
 */
const versionProbe = spawnSync("pnpm", ["exec", "vitest", "--version"], {
  env,
  stdio: "ignore",
});

const extraArgs = process.argv.slice(2);

const commandPrefix = versionProbe.status === 0
  ? ["exec", "vitest"]
  : ["dlx", "vitest@2.1.9"];

/**
 * Determine whether the caller already supplied their own include/exclude
 * filters (either through explicit flags or positional globs). When present we
 * skip the advanced orchestration below so the invoker retains full control
 * over which files execute.
 */
const callerSpecifiedFilters = extraArgs.some((arg) =>
  arg.startsWith("--include") ||
  arg.startsWith("--exclude") ||
  arg.startsWith("--shard") ||
  !arg.startsWith("-"),
);

const runSharded = (baseArgs, shards, runEnv) => {
  for (const shard of shards) {
    const invocation = [...commandPrefix, ...baseArgs, `--shard=${shard}`];
    const shardResult = spawnSync("pnpm", invocation, { stdio: "inherit", env: runEnv });

    if (typeof shardResult.status === "number" && shardResult.status !== 0) {
      process.exit(shardResult.status);
    }

    if (shardResult.error) {
      throw shardResult.error;
    }
  }
};

if (callerSpecifiedFilters) {
  const passthroughArgs = ["run", "--coverage", ...extraArgs];
  const coverageEnv = { ...env, VITEST_COVERAGE: env.VITEST_COVERAGE ?? "true" };
  runSharded(passthroughArgs, ["1/1"], coverageEnv);
  process.exit(0);
}

/**
 * Phase 1: run the Node-centric unit tests with coverage enabled. We shard the
 * suite across two invocations while explicitly excluding the React component
 * tests that require jsdom. Those run separately without coverage to avoid the
 * worker-based OOMs observed on CI.
 */
/**
 * Directories containing Node-targeted unit tests. Executing these suites with
 * coverage enabled captures the server-side regression surface without pulling
 * in the heavy React component specs that require jsdom.
 */
const coverageFilters = [
  "tests/unit/ai",
  "tests/unit/auth",
  "tests/unit/chat",
  "tests/unit/config",
  "tests/unit/db",
  "tests/unit/finance",
  "tests/unit/helpers",
  "tests/unit/lib",
  "tests/unit/prompts",
  "tests/unit/routes",
  "tests/unit/utils",
];

const coverageArgs = [
  "run",
  "--coverage",
  ...extraArgs,
  ...coverageFilters,
];

const coverageEnv = { ...env, VITEST_COVERAGE: "true", VITEST_JUNIT: "true" };

runSharded(coverageArgs, ["1/2", "2/2"], coverageEnv);

/**
 * Phase 2: execute the React-driven suites without coverage instrumentation.
 * Running these files in isolation keeps tinypool's worker threads well below
 * the default 512 MB heap limit that triggered repeated ERR_WORKER_OUT_OF_MEMORY
 * crashes when coverage stayed enabled.
 */
/**
 * React-driven suites rely on jsdom and tend to load large component graphs.
 * Running them without coverage keeps tinypool's worker threads comfortably
 * below their default 512 MB heap limit.
 */
const componentFilters = [
  "tests/unit/components",
  "tests/unit/settings",
];

const componentArgs = [
  "run",
  ...extraArgs,
  ...componentFilters,
];

const componentEnv = { ...env, VITEST_JUNIT: "false" };
delete componentEnv.VITEST_COVERAGE;

runSharded(componentArgs, ["1/2", "2/2"], componentEnv);

process.exit(0);
