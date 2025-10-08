/**
 * Lightweight ping endpoint used by Playwright's `webServer` readiness check.
 * It mirrors the legacy Next.js boilerplate behaviour where `/ping` returned a
 * bare response to signal server availability, which keeps compatibility with
 * tooling expecting the route to exist.
 */
export async function GET(): Promise<Response> {
  // Plain text keeps the response trivial to inspect when debugging slow or
  // failing readiness checks without introducing JSON parsing overhead.
  return new Response("pong", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
