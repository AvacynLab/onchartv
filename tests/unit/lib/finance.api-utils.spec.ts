import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("logRouteLatency", () => {
  it("masque les identifiants sensibles avant d'émettre le log", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { logRouteLatency } = await import("@/lib/finance/api-utils");
    const startedAt = performance.now();

    logRouteLatency("finance.test", startedAt, {
      clientKey: "203.0.113.7",
      symbol: "AAPL",
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [, payload] = infoSpy.mock.calls[0]!;

    expect(payload).toMatchObject({ symbol: "AAPL" });
    expect(payload.clientKey).toMatch(/\[fingerprint:[0-9a-f]{12}\]/);

    infoSpy.mockRestore();
  });
});
