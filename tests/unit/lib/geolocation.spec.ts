import { describe, expect, it, vi } from "vitest";

import { resolveRequestGeolocation } from "@/lib/ai/geolocation";

describe("resolveRequestGeolocation", () => {
  it("short-circuits lookups in Playwright-like environments", () => {
    const geolocationSpy = vi.fn(() => ({
      longitude: 1,
      latitude: 2,
      city: "Test City",
      country: "TC",
    }));

    const result = resolveRequestGeolocation(new Request("https://example.com"), {
      env: { PLAYWRIGHT: "true" },
      geolocationFn: geolocationSpy,
    });

    expect(result).toEqual({
      longitude: undefined,
      latitude: undefined,
      city: undefined,
      country: undefined,
    });
    expect(geolocationSpy).not.toHaveBeenCalled();
  });

  it("normalises the raw Vercel geolocation payload", () => {
    const result = resolveRequestGeolocation(new Request("https://example.com"), {
      env: {},
      geolocationFn: () => ({
        longitude: 12.34,
        latitude: 56.78,
        city: "Paris",
        country: "FR",
        // @ts-expect-error — simulate extra metadata the helper should ignore.
        region: "IDF",
      }),
    });

    expect(result).toEqual({
      longitude: 12.34,
      latitude: 56.78,
      city: "Paris",
      country: "FR",
    });
  });

  it("logs a warning and returns fallback values when the lookup fails", () => {
    const error = new Error("network offline");
    const logger = vi.fn();

    const result = resolveRequestGeolocation(new Request("https://example.com"), {
      env: {},
      geolocationFn: () => {
        throw error;
      },
      onFailure: logger,
    });

    expect(result).toEqual({
      longitude: undefined,
      latitude: undefined,
      city: undefined,
      country: undefined,
    });
    expect(logger).toHaveBeenCalledWith(
      "chat.geolocation",
      "Falling back to empty geolocation",
      { error }
    );
  });
});
