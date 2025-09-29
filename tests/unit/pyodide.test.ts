import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getPyodideScriptSrc,
  PLAYWRIGHT_PYODIDE_SRC,
  REMOTE_PYODIDE_SRC,
} from "@/lib/pyodide";

/**
 * Unit coverage for the Pyodide helper ensures the Playwright suite keeps using
 * the hermetic stub while production continues to rely on the official CDN.
 */
describe("getPyodideScriptSrc", () => {
  it("returns the CDN bundle by default", () => {
    const source = getPyodideScriptSrc({});
    assert.equal(source, REMOTE_PYODIDE_SRC);
  });

  it("switches to the Playwright stub when the flag is enabled", () => {
    const source = getPyodideScriptSrc({ PLAYWRIGHT: "true" });
    assert.equal(source, PLAYWRIGHT_PYODIDE_SRC);
  });

  it("honours the public runtime flag exposed to the client", () => {
    const source = getPyodideScriptSrc({ NEXT_PUBLIC_PLAYWRIGHT: "true" });
    assert.equal(source, PLAYWRIGHT_PYODIDE_SRC);
  });

  it("detects hermetic runs configured via base URL", () => {
    const source = getPyodideScriptSrc({ PLAYWRIGHT_TEST_BASE_URL: "http://localhost:3100" });
    assert.equal(source, PLAYWRIGHT_PYODIDE_SRC);
  });
});
