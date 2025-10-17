import { describe, expect, it } from "vitest";

import { isChatPathname } from "../../utils/chat-redirect";

describe("isChatPathname", () => {
  it("returns true for the canonical chat route", () => {
    expect(isChatPathname("http://localhost:3100/chat")).toBe(true);
  });

  it("accepts nested chat routes and query parameters", () => {
    expect(isChatPathname("https://example.com/chat/abc")).toBe(true);
    expect(isChatPathname("https://example.com/chat?foo=bar")).toBe(true);
  });

  it("rejects unrelated routes", () => {
    expect(isChatPathname("http://localhost:3100/login")).toBe(false);
    expect(isChatPathname("https://example.com/dashboard")).toBe(false);
  });

  it("handles malformed URLs without throwing", () => {
    expect(isChatPathname("not a valid url")).toBe(false);
    expect(isChatPathname("")).toBe(false);
  });
});
