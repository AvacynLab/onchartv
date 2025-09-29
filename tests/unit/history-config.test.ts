/**
 * Unit tests validating the offline chat history configuration used during
 * Playwright runs. These checks ensure we never attempt live network requests
 * when the hermetic environment is active.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  createHistorySWRConfig,
  isPlaywrightFeatureEnabled,
  type ChatHistoryPage,
} from "../../lib/history/config";

test.describe("chat history Playwright guard", () => {
  test("detects the Playwright flag from either server or client env vars", () => {
    assert.equal(
      isPlaywrightFeatureEnabled({ PLAYWRIGHT: "true" }),
      true,
      "Server-side PLAYWRIGHT flag should enable offline mode",
    );

    assert.equal(
      isPlaywrightFeatureEnabled({ NEXT_PUBLIC_PLAYWRIGHT: "true" }),
      true,
      "Client-side NEXT_PUBLIC_PLAYWRIGHT flag should also enable offline mode",
    );

    assert.equal(
      isPlaywrightFeatureEnabled({}),
      false,
      "No environment markers should keep regular behaviour enabled",
    );
  });

  test("pauses SWR revalidation when Playwright is active", () => {
    const initialPage: ChatHistoryPage = { chats: [], hasMore: false };

    const config = createHistorySWRConfig({ initialPage, pause: true });

    assert.equal(config.revalidateOnFocus, false);
    assert.equal(config.revalidateOnReconnect, false);
    assert.equal(config.revalidateIfStale, false);
    assert.equal(config.revalidateFirstPage, false);
    assert.equal(typeof config.isPaused, "function");
    assert.equal(config.isPaused?.(), true);
    assert.equal(config.refreshInterval, 0);
    assert.equal(config.dedupingInterval, Infinity);
    assert.deepEqual(config.fallbackData, [initialPage]);
  });

  test("keeps SWR defaults when Playwright is disabled", () => {
    const config = createHistorySWRConfig({ pause: false });

    assert.equal(config.revalidateOnFocus, true);
    assert.equal(config.revalidateOnReconnect, true);
    assert.equal(config.revalidateIfStale, true);
    assert.equal(config.revalidateFirstPage, true);
    assert.equal(config.isPaused, undefined);
    assert.equal(config.refreshInterval, undefined);
    assert.equal(config.dedupingInterval, undefined);
    assert.deepEqual(config.fallbackData, []);
  });
});
