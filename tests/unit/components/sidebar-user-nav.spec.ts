import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shouldDisableRemoteAvatars } from "@/components/utils/automation";

type AutomationNavigator = { webdriver?: boolean };

const originalEnv = { ...process.env } as NodeJS.ProcessEnv;
// Normalise the baseline environment so automation-specific flags set by other
// suites (notably PLAYWRIGHT/CI_PLAYWRIGHT) do not leak into these assertions.
delete originalEnv.PLAYWRIGHT;
delete originalEnv.CI_PLAYWRIGHT;
delete originalEnv.NEXT_PUBLIC_PLAYWRIGHT;

describe("shouldDisableRemoteAvatars", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    if (typeof window !== "undefined") {
      /**
       * Ensure prior specs that toggled the Playwright bridge do not leak the
       * window flag into these assertions. The runtime detector treats the
       * marker as a definitive automation signal, so clearing it keeps this
       * suite anchored to its explicit test cases.
       */
      delete (window as typeof window & { __PLAYWRIGHT_AUTOMATION__?: boolean })
        .__PLAYWRIGHT_AUTOMATION__;
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    if (typeof window !== "undefined") {
      delete (window as typeof window & { __PLAYWRIGHT_AUTOMATION__?: boolean })
        .__PLAYWRIGHT_AUTOMATION__;
    }
  });

  it("returns true when NEXT_PUBLIC_PLAYWRIGHT is true", () => {
    process.env.NEXT_PUBLIC_PLAYWRIGHT = "true";
    expect(shouldDisableRemoteAvatars()).toBe(true);
  });

  it("returns true when the browser advertises webdriver", () => {
    delete process.env.NEXT_PUBLIC_PLAYWRIGHT;
    vi.stubGlobal("navigator", { webdriver: true } as AutomationNavigator);
    expect(shouldDisableRemoteAvatars()).toBe(true);
  });

  it("returns false when automation hints are absent", () => {
    delete process.env.NEXT_PUBLIC_PLAYWRIGHT;
    expect(shouldDisableRemoteAvatars()).toBe(false);
  });
});
