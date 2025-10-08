import { describe, expect, it } from "vitest";

import { GET } from "@/app/ping/route";

describe("/ping", () => {
  it("responds with a plain-text pong", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );

    const text = await response.text();
    expect(text).toBe("pong");
  });
});
