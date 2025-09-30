import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Resolve the project root so Vitest matches the Next.js path aliases ("@/").
 * Using `fileURLToPath` keeps the configuration compatible with ESM modules.
 */
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

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
      reporter: ["text", "lcov"],
    },
  },
});
