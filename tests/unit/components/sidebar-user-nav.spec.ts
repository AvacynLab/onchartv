import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shouldDisableRemoteAvatars } from "@/components/utils/automation";

type AutomationNavigator = { webdriver?: boolean };

const originalEnv = { ...process.env };

describe("shouldDisableRemoteAvatars", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
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
