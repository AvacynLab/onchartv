import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logError, logWarning, sanitizeForLogging } from "@/lib/logging";

describe("logging helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("redacts sensitive keys recursively", () => {
    const payload = {
      apiKey: "super-secret",
      nested: {
        token: "still-secret",
        safe: "value",
      },
    };

    const result = sanitizeForLogging(payload);

    expect(result).toEqual({
      apiKey: "[redacted]",
      nested: {
        token: "[redacted]",
        safe: "value",
      },
    });
  });

  it("redacts sensitive bearer-like values", () => {
    expect(sanitizeForLogging("Bearer sk-123456789"))
      .toBe("[redacted]");
  });

  it("emits structured error logs with sanitised extras", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Boom");

    const entry = logError("tests", error, { authorization: "Bearer token" });

    expect(entry.level).toBe("error");
    expect(entry.context).toBe("tests");
    expect(entry.message).toBeUndefined();
    expect(entry.data).toMatchObject({ name: "Error", message: "Boom" });
    expect(entry.extra).toEqual({ authorization: "[redacted]" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("[tests]");
    expect(spy.mock.calls[0]?.[1]).toEqual(entry);
  });

  it("supports warning logs with string payloads", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const entry = logWarning("tests", "Heads up", { cookie: "abc" });

    expect(entry.level).toBe("warn");
    expect(entry.message).toBe("Heads up");
    expect(entry.extra).toEqual({ cookie: "[redacted]" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toEqual(entry);
  });
});
