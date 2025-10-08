import { NextResponse } from "next/server";

/**
 * Health endpoint leveraged by automated tests (Playwright global setup and CI
 * health probes) to confirm that the Next.js server finished booting before the
 * suites start hitting application routes. Returning a `200` with minimal JSON
 * keeps the checks fast while remaining human-readable when debugging.
 */
export async function GET(): Promise<NextResponse<{ status: string; timestamp: string }>> {
  const payload = {
    status: "ok",
    // Capture the timestamp to help correlate health responses with server logs
    // when diagnosing flaky Playwright runs.
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      // Disable caching to prevent browsers or intermediate proxies from
      // serving stale responses during readiness checks.
      "cache-control": "no-store",
    },
  });
}
