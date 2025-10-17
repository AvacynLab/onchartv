import { describe, expect, it } from "vitest";

import { resolveNextDevCommand } from "../../utils/next-dev-command";

describe("resolveNextDevCommand", () => {
  it("uses pnpm dev by default for local workflows", () => {
    const result = resolveNextDevCommand({});

    expect(result).toEqual({
      command: "pnpm",
      args: ["dev"],
      rationale:
        "No hermetic flags detected; using the default pnpm dev script with Turbopack for faster local refreshes.",
    });
  });

  it("switches to pnpm exec next dev when Playwright flag is active", () => {
    const result = resolveNextDevCommand({ PLAYWRIGHT: "true" });

    expect(result).toEqual({
      command: "pnpm",
      args: ["exec", "next", "dev"],
      rationale:
        "Playwright hermetic flags detected; launching Next.js without the Turbopack flag so we reuse the classic webpack dev server and dodge module resolution issues like the missing @tanstack/react-query crash.",
    });
  });

  it("switches to webpack dev when only the hermetic provider flag is active", () => {
    const result = resolveNextDevCommand({ HERMETIC_CHAT_PROVIDER: "true" });

    expect(result).toEqual({
      command: "pnpm",
      args: ["exec", "next", "dev"],
      rationale:
        "Playwright hermetic flags detected; launching Next.js without the Turbopack flag so we reuse the classic webpack dev server and dodge module resolution issues like the missing @tanstack/react-query crash.",
    });
  });

  it("respects manual server override even when Playwright flags are set", () => {
    const result = resolveNextDevCommand({
      PLAYWRIGHT: "true",
      PLAYWRIGHT_MANUAL_SERVER: "true",
    });

    expect(result).toEqual({
      command: "pnpm",
      args: ["dev"],
      rationale:
        "Manual Playwright server requested; deferring to the default pnpm dev script.",
    });
  });
});
