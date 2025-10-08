import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

describe("/api/health", () => {
  it("returns a JSON payload marking the server as healthy", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const payload = await response.json();
    expect(payload.status).toBe("ok");
    expect(typeof payload.timestamp).toBe("string");
    expect(() => new Date(payload.timestamp)).not.toThrow();
  });
});
