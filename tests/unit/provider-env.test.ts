/**
 * Unit coverage for the Playwright environment detection helper. The
 * OpenAI provider relies on this logic to decide when to serve hermetic
 * language-model mocks instead of attempting to load the real SDK.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { isPlaywrightLikeEnvironment } from "../../lib/ai/playwright-env";

test.describe("Playwright environment heuristics", () => {
  test("detects server-side flags", () => {
    assert.equal(
      isPlaywrightLikeEnvironment({ PLAYWRIGHT: "true" }),
      true,
      "PLAYWRIGHT=true should enable the hermetic mocks"
    );

    assert.equal(
      isPlaywrightLikeEnvironment({ CI_PLAYWRIGHT: "true" }),
      true,
      "CI marker should also trigger Playwright mode"
    );

    assert.equal(
      isPlaywrightLikeEnvironment({ PLAYWRIGHT_TEST_BASE_URL: "http://localhost:3100" }),
      true,
      "Providing a manual base URL should be treated as a Playwright run"
    );
  });

  test("detects manual server runs that only set client-side flags", () => {
    assert.equal(
      isPlaywrightLikeEnvironment({ NEXT_PUBLIC_PLAYWRIGHT: "true" }),
      true,
      "Manual Next.js servers export NEXT_PUBLIC_PLAYWRIGHT for the client UI"
    );
  });

  test("keeps production behaviour when no flags are set", () => {
    assert.equal(
      isPlaywrightLikeEnvironment({}),
      false,
      "Absence of Playwright markers should preserve the real provider"
    );
  });
});
