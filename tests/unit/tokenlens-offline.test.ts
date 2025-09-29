/**
 * Lightweight unit test suite validating the TokenLens offline guard behaviour
 * used during Playwright runs.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  createTokenlensEnvironment,
  shouldFetchTokenlensCatalog,
} from "../../lib/ai/tokenlens";

test.describe("TokenLens catalog toggles", () => {
  test("disables catalog download when Playwright flag is set", () => {
    const env = createTokenlensEnvironment({ PLAYWRIGHT: "true" });

    assert.equal(
      shouldFetchTokenlensCatalog(env),
      false,
      "Playwright runs should skip network fetches to stay offline"
    );
  });

  test("keeps catalog download enabled by default", () => {
    const env = createTokenlensEnvironment({ PLAYWRIGHT: undefined });

    assert.equal(
      shouldFetchTokenlensCatalog(env),
      true,
      "Production environments must retain the catalog fetch"
    );
  });
});
