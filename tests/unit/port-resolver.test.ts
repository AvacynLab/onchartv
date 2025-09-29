import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import {
  resolvePreferredPort,
  resolvePreferredPortSync,
} from "../utils/port-resolver";

async function getAvailablePort(): Promise<number> {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Expected AddressInfo"));
        return;
      }

      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

test("reuses the preferred port when it is available", async () => {
  const preferredPort = await getAvailablePort();

  const result = await resolvePreferredPort({ preferredPort });

  assert.equal(result.port, preferredPort);
  assert.equal(result.didFallback, false);
});

test("falls back to an ephemeral port when the preferred port is taken", async () => {
  const preferredPort = await getAvailablePort();
  const blockingServer = createServer();

  await new Promise<void>((resolve, reject) => {
    blockingServer.once("error", reject);
    blockingServer.listen(preferredPort, "127.0.0.1", () => resolve());
  });

  const result = await resolvePreferredPort({ preferredPort });

  assert.notEqual(result.port, preferredPort);
  assert.equal(result.didFallback, true);

  await new Promise<void>((resolve, reject) => {
    blockingServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  // Sanity check that the fallback port is free after the resolver closes its
  // probe server. If we can bind to it here, Playwright can launch Next.js on
  // the same port later.
  const verificationServer = createServer();
  await new Promise<void>((resolve, reject) => {
    verificationServer.once("error", reject);
    verificationServer.listen(result.port, "127.0.0.1", () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    verificationServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

test("resolvePreferredPortSync blocks until the asynchronous probe completes", async () => {
  const preferredPort = await getAvailablePort();
  const blockingServer = createServer();

  await new Promise<void>((resolve, reject) => {
    blockingServer.once("error", reject);
    blockingServer.listen(preferredPort, "127.0.0.1", () => resolve());
  });

  const result = resolvePreferredPortSync({ preferredPort });

  assert.equal(result.didFallback, true);
  assert.notEqual(result.port, preferredPort);

  await new Promise<void>((resolve, reject) => {
    blockingServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});
