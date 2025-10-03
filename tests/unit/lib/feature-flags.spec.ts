import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isFinanceFeatureEnabled,
  isFinanceFeatureEnabledClient,
  parseBooleanFlag,
} from "@/lib/feature-flags";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseBooleanFlag", () => {
  it("returns the default for undefined values", () => {
    expect(parseBooleanFlag(undefined, { defaultValue: false })).toBe(false);
  });

  it("normalises truthy strings", () => {
    expect(parseBooleanFlag("TRUE", { defaultValue: false })).toBe(true);
    expect(parseBooleanFlag("  On  ")).toBe(true);
  });

  it("treats blank values as default", () => {
    expect(parseBooleanFlag("", { defaultValue: false })).toBe(false);
    expect(parseBooleanFlag("   ")).toBe(true);
  });
});

describe("isFinanceFeatureEnabled", () => {
  it("defaults to true when the flag is absent", () => {
    expect(isFinanceFeatureEnabled({})).toBe(true);
  });

  it("honours explicit opt-outs", () => {
    expect(isFinanceFeatureEnabled({ FEATURE_FINANCE: "false" })).toBe(false);
  });
});

describe("isFinanceFeatureEnabledClient", () => {
  it("mirrors the NEXT_PUBLIC flag", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "false");
    expect(isFinanceFeatureEnabledClient()).toBe(false);
  });

  it("falls back to the default when unset", () => {
    expect(isFinanceFeatureEnabledClient()).toBe(true);
  });
});
