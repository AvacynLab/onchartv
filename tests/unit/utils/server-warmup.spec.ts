import { describe, expect, it, vi, afterEach } from "vitest";

import { warmupNextRoutes } from "../../utils/server-warmup";

describe("warmupNextRoutes", () => {
  const baseURL = "http://localhost:3000";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefetches each route when responses are successful", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));

    await warmupNextRoutes(baseURL, {
      routes: ["/", "/login"],
      fetchImpl: fetchMock,
      retryDelayMs: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${baseURL}/`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${baseURL}/login`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("retries non-OK responses and logs a preview snippet", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Application error: overlay stacktrace", { status: 500 }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await warmupNextRoutes(baseURL, {
      routes: ["/chat"],
      fetchImpl: fetchMock,
      retryDelayMs: 0,
      maxAttempts: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("status 500"),
    );
    expect(warnSpy.mock.calls[0][0]).toContain("Preview: \"Application error: overlay stacktrace\"");
  });

  it("throws an enriched error when every attempt fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("Application error: Something went terribly wrong", { status: 500 }),
      );

    const promise = warmupNextRoutes(baseURL, {
      routes: ["/broken"],
      fetchImpl: fetchMock,
      retryDelayMs: 0,
      maxAttempts: 2,
    });

    await expect(promise).rejects.toThrowError(/status 500/);
    await promise.catch((error) => {
      expect(error).toBeInstanceOf(Error);
      const root = error as Error & { cause?: unknown };
      expect(root.cause).toBeInstanceOf(Error);
      const cause = root.cause as Error & {
        status?: number;
        preview?: string | null;
      };
      expect(cause.status).toBe(500);
      if (cause.preview != null) {
        expect(cause.preview).toContain("Application error: Something went terribly wrong");
      }
    });
  });

  it("surfaces the underlying fetch error when the request rejects", async () => {
    const failure = new TypeError("connect ECONNREFUSED 127.0.0.1:3100");
    const fetchMock = vi.fn().mockRejectedValue(failure);

    await expect(
      warmupNextRoutes(baseURL, {
        routes: ["/"],
        fetchImpl: fetchMock,
        retryDelayMs: 0,
        maxAttempts: 2,
      }),
    ).rejects.toThrowError(/connect ECONNREFUSED/);
  });
});
