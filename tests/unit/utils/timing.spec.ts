import { describe, expect, it, vi } from "vitest";

import { withStepTiming } from "../../utils/timing";

describe("withStepTiming", () => {
  it("logs the elapsed time and returns the task result", async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const nowValues = [0, 12];
    const now = () => nowValues.shift() ?? 12;

    const result = await withStepTiming({
      label: "warmup",
      logger: { info, warn },
      now,
      task: async () => {
        return "ok";
      },
    });

    expect(result).toBe("ok");
    expect(info).toHaveBeenCalledWith("[#timing] warmup completed in 12ms.");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when the duration exceeds the configured threshold", async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const nowValues = [0, 5_500];
    const now = () => nowValues.shift() ?? 5_500;

    await withStepTiming({
      label: "ensure login",
      logger: { info, warn },
      now,
      thresholdMs: 1_000,
      task: async () => {
        return undefined;
      },
    });

    expect(info).toHaveBeenCalledWith("[#timing] ensure login completed in 5.5s.");
    expect(warn).toHaveBeenCalledWith(
      "[#timing] ensure login exceeded 1.0s (took 5.5s).",
    );
  });

  it("rethrows errors after logging the failure duration", async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const nowValues = [0, 2_000];
    const now = () => nowValues.shift() ?? 2_000;
    const failure = new Error("boom");

    await expect(() =>
      withStepTiming({
        label: "persist state",
        logger: { info, warn },
        now,
        task: async () => {
          throw failure;
        },
      }),
    ).rejects.toThrow(failure);

    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[#timing] persist state failed after 2.0s.", {
      cause: failure,
    });
  });
});
