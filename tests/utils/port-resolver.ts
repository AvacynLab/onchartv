import { spawnSync } from "node:child_process";
import { AddressInfo, createServer } from "node:net";

export interface ResolvePreferredPortOptions {
  /**
   * The port we would like to bind the Next.js dev server to. This is typically
   * 3100 so the base URL matches our manual Playwright runs, but the helper
   * keeps the value configurable for tests.
   */
  preferredPort: number;
  /**
   * Hostname used for the port probe. We default to IPv4 localhost to match
   * the Playwright web server configuration.
   */
  host?: string;
}

export interface ResolvedPortResult {
  /** The port Playwright should launch the dev server on. */
  port: number;
  /** True when we had to fall back to a random port because the preferred one
   * was already bound by another process.
   */
  didFallback: boolean;
}

const DEFAULT_HOST = "127.0.0.1";

async function canBindToPort(port: number, host: string): Promise<boolean> {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      // Another process is already bound to this port. We treat the
      // `EADDRINUSE` case as an expected condition so the caller can request a
      // fallback. Other errors bubble up for visibility.
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function getEphemeralPort(host: string): Promise<number> {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, host, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Expected a numeric address when resolving port"));
        });
        return;
      }

      const { port } = address as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Attempt to reuse the caller's preferred port. If it is already taken (for
 * example, when a previous Next.js dev server crashed and left the socket in
 * use), we fall back to an ephemeral port to keep the Playwright run moving.
 */
export async function resolvePreferredPort({
  preferredPort,
  host = DEFAULT_HOST,
}: ResolvePreferredPortOptions): Promise<ResolvedPortResult> {
  const canUsePreferredPort = await canBindToPort(preferredPort, host);

  if (canUsePreferredPort) {
    return { port: preferredPort, didFallback: false };
  }

  const fallbackPort = await getEphemeralPort(host);

  return { port: fallbackPort, didFallback: true };
}

/**
 * Synchronous wrapper used by the Playwright configuration. We delegate the
 * asynchronous port probe to a short-lived child Node.js process so we can keep
 * the config file synchronous without blocking the event loop.
 */
export function resolvePreferredPortSync(
  options: ResolvePreferredPortOptions
): ResolvedPortResult {
  const script = `
    const { createServer } = require("node:net");

    const preferredPort = ${JSON.stringify(options.preferredPort)};
    const host = ${JSON.stringify(options.host ?? DEFAULT_HOST)};

    function canBindToPort(port, host) {
      const server = createServer();

      return new Promise((resolve, reject) => {
        server.once("error", (error) => {
          if (error.code === "EADDRINUSE") {
            resolve(false);
            return;
          }

          reject(error);
        });

        server.listen(port, host, () => {
          server.close(() => resolve(true));
        });
      });
    }

    function getEphemeralPort(host) {
      const server = createServer();

      return new Promise((resolve, reject) => {
        server.once("error", reject);

        server.listen(0, host, () => {
          const address = server.address();

          if (!address || typeof address === "string") {
            server.close(() => {
              reject(new Error("Expected a numeric address when resolving port"));
            });
            return;
          }

          const { port } = address;
          server.close(() => resolve(port));
        });
      });
    }

    (async () => {
      const canUsePreferredPort = await canBindToPort(preferredPort, host);

      if (canUsePreferredPort) {
        process.stdout.write(JSON.stringify({ port: preferredPort, didFallback: false }));
        return;
      }

      const fallbackPort = await getEphemeralPort(host);
      process.stdout.write(JSON.stringify({ port: fallbackPort, didFallback: true }));
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;

  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf-8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Failed to resolve port: ${result.stderr || result.stdout || "unknown error"}`
    );
  }

  const trimmedOutput = result.stdout.trim();

  if (!trimmedOutput) {
    throw new Error("Port resolver did not return a value");
  }

  return JSON.parse(trimmedOutput) as ResolvedPortResult;
}
