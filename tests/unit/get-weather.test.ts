/**
 * Unit coverage for the weather tool, ensuring the Playwright hermetic
 * environment bypasses the live Open Meteo API while the default behaviour
 * still performs a network request via the injected fetch implementation.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  HERMETIC_WEATHER_SAMPLE,
  createWeatherTool,
  resolveWeather,
} from "../../lib/ai/tools/get-weather";

test.describe("Weather tool", () => {
  test("replays deterministic payload when Playwright flag is set", async () => {
    const tool = createWeatherTool({
      env: { PLAYWRIGHT: "true" } as NodeJS.ProcessEnv,
      fetchImpl: async () => {
        throw new Error("Hermetic mode should not reach the network");
      },
    });

    const result = await tool.execute({ latitude: 0, longitude: 0 });

    assert.deepEqual(
      result,
      HERMETIC_WEATHER_SAMPLE,
      "Playwright runs must reuse the cached weather payload"
    );

    assert.ok(
      Array.isArray(result.hourly.temperature_2m) &&
        result.hourly.temperature_2m.length > 0,
      "Hermetic payload should expose hourly temperatures for the UI"
    );
  });

  test("delegates to fetch implementation outside hermetic runs", async () => {
    const capturedUrls: Array<string> = [];
    const fakeResponse = {
      ok: true,
      json: async () => ({ success: true }),
    };

    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      capturedUrls.push(String(input));
      return fakeResponse as unknown as Response;
    }) as typeof fetch;

    const result = await resolveWeather(
      { latitude: 51.5, longitude: -0.12 },
      { env: {} as NodeJS.ProcessEnv, fetchImpl }
    );

    assert.deepEqual(
      capturedUrls,
      [
        "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto",
      ],
      "Live runs should hit the Open Meteo endpoint with provided coordinates"
    );

    assert.deepEqual(
      result,
      { success: true },
      "The helper must return the JSON payload from the fetch implementation"
    );
  });
});
