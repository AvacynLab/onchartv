#!/usr/bin/env node
/**
 * Ensure Vitest runs with an expanded heap size so coverage-enabled runs avoid
 * the 4 GB default limit that repeatedly triggered OOM failures on CI.
 */
import { spawnSync } from "node:child_process";

/** Desired heap size (in megabytes) for coverage-heavy Vitest runs. */
const DESIRED_HEAP_MB = 8192;

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

const vitestInvocation = versionProbe.status === 0
  ? ["exec", "vitest", "run", "--coverage", ...extraArgs]
  : ["dlx", "vitest@2.1.4", "run", "--coverage", ...extraArgs];

const result = spawnSync("pnpm", vitestInvocation, { stdio: "inherit", env });

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
