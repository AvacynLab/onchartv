import { tool } from "ai";
import { z } from "zod";

/**
 * Deterministic weather payload replayed whenever the Playwright hermetic test
 * environment is active. Returning the same structure as the real Open Meteo
 * API keeps the downstream language-model mocks happy while ensuring the suite
 * never attempts to reach the public network.
 */
export const HERMETIC_WEATHER_SAMPLE = {
  latitude: 37.763_283,
  longitude: -122.412_86,
  generationtime_ms: 0.064_492_225_646_972_66,
  utc_offset_seconds: -25_200,
  timezone: "America/Los_Angeles",
  timezone_abbreviation: "GMT-7",
  elevation: 18,
  current_units: {
    time: "iso8601",
    interval: "seconds",
    temperature_2m: "°C",
  },
  current: {
    time: "2025-03-10T14:00",
    interval: 900,
    temperature_2m: 17,
  },
  hourly_units: {
    time: "iso8601",
    temperature_2m: "°C",
  },
  hourly: {
    time: [
      "2025-03-10T00:00",
      "2025-03-10T01:00",
      "2025-03-10T02:00",
      "2025-03-10T03:00",
      "2025-03-10T04:00",
      "2025-03-10T05:00",
      "2025-03-10T06:00",
      "2025-03-10T07:00",
      "2025-03-10T08:00",
      "2025-03-10T09:00",
      "2025-03-10T10:00",
      "2025-03-10T11:00",
      "2025-03-10T12:00",
      "2025-03-10T13:00",
      "2025-03-10T14:00",
      "2025-03-10T15:00",
      "2025-03-10T16:00",
      "2025-03-10T17:00",
      "2025-03-10T18:00",
      "2025-03-10T19:00",
      "2025-03-10T20:00",
      "2025-03-10T21:00",
      "2025-03-10T22:00",
      "2025-03-10T23:00",
    ],
    temperature_2m: [
      12, 11, 10, 9, 9, 8, 8, 9, 10, 12, 14, 16, 17, 18, 17, 16, 15, 14, 13, 13,
      12, 12, 11, 11,
    ],
  },
  daily_units: {
    time: "iso8601",
    sunrise: "iso8601",
    sunset: "iso8601",
  },
  daily: {
    time: [
      "2025-03-10",
      "2025-03-11",
      "2025-03-12",
      "2025-03-13",
      "2025-03-14",
      "2025-03-15",
      "2025-03-16",
    ],
    sunrise: [
      "2025-03-10T07:27",
      "2025-03-11T07:25",
      "2025-03-12T07:24",
      "2025-03-13T07:22",
      "2025-03-14T07:21",
      "2025-03-15T07:19",
      "2025-03-16T07:18",
    ],
    sunset: [
      "2025-03-10T19:12",
      "2025-03-11T19:13",
      "2025-03-12T19:14",
      "2025-03-13T19:15",
      "2025-03-14T19:16",
      "2025-03-15T19:17",
      "2025-03-16T19:17",
    ],
  },
} as const;

type CreateWeatherToolOptions = {
  /**
   * Environment variables inspected to determine whether the hermetic mocks
   * should kick in. Tests can inject a scoped object to simulate the
   * Playwright runtime without mutating `process.env`.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Fetch implementation used for live weather requests. Allowing dependency
   * injection keeps the helper testable without performing real network calls.
   */
  fetchImpl?: typeof fetch;
};

function isHermeticWeatherEnvironment(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.PLAYWRIGHT_TEST_BASE_URL || env.PLAYWRIGHT || env.CI_PLAYWRIGHT);
}

type WeatherCoordinates = {
  latitude: number;
  longitude: number;
};

export async function resolveWeather(
  { latitude, longitude }: WeatherCoordinates,
  { env = process.env, fetchImpl = fetch }: CreateWeatherToolOptions = {}
) {
  if (isHermeticWeatherEnvironment(env)) {
    /**
     * Clone the cached payload so consumers can safely mutate the returned
     * object without affecting subsequent test runs.
     */
    return structuredClone(HERMETIC_WEATHER_SAMPLE);
  }

  const response = await fetchImpl(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
  );

  const weatherData = await response.json();
  return weatherData;
}

export function createWeatherTool(options: CreateWeatherToolOptions = {}) {
  return tool({
    description: "Get the current weather at a location",
    inputSchema: z.object({
      latitude: z.number(),
      longitude: z.number(),
    }),
    execute: ({ latitude, longitude }) =>
      resolveWeather({ latitude, longitude }, options),
  });
}

export const getWeather = createWeatherTool();
