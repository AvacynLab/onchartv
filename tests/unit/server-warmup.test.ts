import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { warmupNextRoutes } from "../utils/server-warmup";

describe("warmupNextRoutes", () => {
  it("fetches each warm-up route sequentially", async () => {
    const requests: string[] = [];

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push(url);

      return new Response("ok", { status: 200 });
    };

    await warmupNextRoutes("http://localhost:3100", {
      fetchImpl: mockFetch,
      routes: ["/", "/register"],
      timeoutMs: 10,
      maxAttempts: 1,
    });

    assert.deepEqual(requests, ["http://localhost:3100/", "http://localhost:3100/register"]);
  });

  it("throws when a warm-up request fails", async () => {
    const mockFetch: typeof fetch = async () => new Response("boom", { status: 500 });

    const requests: string[] = [];

    await assert.rejects(
      warmupNextRoutes("http://localhost:3100", {
        fetchImpl: async (input) => {
          const url = typeof input === "string" ? input : input.toString();
          requests.push(url);
          return mockFetch(input);
        },
        maxAttempts: 2,
      }),
      (error: unknown) => {
        assert.match(String(error), /Failed to warm Next\.js route/);
        assert.match(String((error as Error).cause), /status 500/);
        return true;
      }
    );

    assert.equal(requests.length, 2);
  });

  it("propagates network errors from fetch", async () => {
    const mockFetch: typeof fetch = async () => {
      throw new TypeError("socket hang up");
    };

    await assert.rejects(
      warmupNextRoutes("http://localhost:3100", {
        fetchImpl: mockFetch,
        maxAttempts: 2,
        retryDelayMs: 1,
      }),
      (error: unknown) => {
        assert.match(String(error), /Failed to warm Next\.js route/);
        assert.ok((error as Error).cause instanceof TypeError);
        assert.match(String((error as Error).cause), /socket hang up/);
        return true;
      }
    );
  });

  it("retries failed attempts before succeeding", async () => {
    let attempts = 0;

    const mockFetch: typeof fetch = async () => {
      attempts += 1;

      if (attempts < 2) {
        throw new TypeError("initial compile timeout");
      }

      return new Response("ok", { status: 200 });
    };

    await warmupNextRoutes("http://localhost:3100", {
      fetchImpl: mockFetch,
      timeoutMs: 5,
      retryDelayMs: 1,
      routes: ["/"],
    });

    assert.equal(attempts, 2);
  });
});
