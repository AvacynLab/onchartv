/**
 * Unit coverage for the login link helper used by the public share sidebar.
 *
 * The Next.js component itself is rendered client-side, so this focused helper
 * keeps the logic testable in a hermetic Node.js environment.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildLoginHref } from "../../components/share-sidebar";

test.describe("buildLoginHref", () => {
  test("falls back to the generic login page when no pathname is present", () => {
    assert.equal(buildLoginHref(null), "/login");
    assert.equal(buildLoginHref(undefined), "/login");
    assert.equal(buildLoginHref(""), "/login");
  });

  test("preserves the visitor pathname via the callback query parameter", () => {
    const href = buildLoginHref("/share/thread-123?mode=preview");

    assert.equal(
      href,
      "/login?callbackUrl=%2Fshare%2Fthread-123%3Fmode%3Dpreview",
      "The pathname should be URI encoded so redirects remain safe",
    );
  });
});
