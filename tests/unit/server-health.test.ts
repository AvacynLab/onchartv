import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { waitForServerReady } from "../utils/server-health";

describe("waitForServerReady", () => {
  it("resolves once the health endpoint returns a successful response", async () => {
    let callCount = 0;

    const fetchMock: typeof fetch = async () => {
      callCount += 1;

      if (callCount < 3) {
        throw new Error("connect ECONNREFUSED");
      }

      return new Response("pong", { status: 200 });
    };

    await waitForServerReady("http://localhost:1234", {
      attempts: 5,
      delayMs: 1,
      timeoutMs: 10,
      fetchImpl: fetchMock,
    });

    assert.equal(callCount, 3);
  });

  it("throws when the server never responds successfully", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("connect ECONNREFUSED");
    };

    await assert.rejects(
      waitForServerReady("http://localhost:1234", {
        attempts: 3,
        delayMs: 1,
        timeoutMs: 10,
        fetchImpl: fetchMock,
      }),
      /did not respond/
    );
  });
});
