import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Weather,
  WEATHER_FALLBACK_SAMPLE,
  normaliseWeatherPayload,
  type WeatherAtLocation,
} from "@/components/weather";

describe("Weather component", () => {
  it("normalises incomplete payloads with fallback hourly data", () => {
    const partial: Partial<WeatherAtLocation> = {
      current: {
        ...WEATHER_FALLBACK_SAMPLE.current,
        temperature_2m: 21,
      },
      hourly: { time: [], temperature_2m: [] },
    };

    const normalised = normaliseWeatherPayload(partial);

    expect(normalised.current.temperature_2m).toBe(21);
    expect(normalised.hourly.temperature_2m.length).toBeGreaterThan(0);
    expect(normalised.hourly.time.length).toBeGreaterThan(0);
    expect(normalised.hourly_units.temperature_2m).toBe(
      WEATHER_FALLBACK_SAMPLE.hourly_units.temperature_2m
    );
  });

  it("renders without crashing when provided hourly data is missing", () => {
    const degradedPayload: WeatherAtLocation = {
      ...WEATHER_FALLBACK_SAMPLE,
      hourly: { time: [], temperature_2m: [] },
    };

    render(<Weather weatherAtLocation={degradedPayload} />);

    expect(screen.getByText(/H:/)).toBeInTheDocument();
    const unitNodes = screen.getAllByText((content) =>
      content.replace(/\s+/g, " ").includes(
        WEATHER_FALLBACK_SAMPLE.current_units.temperature_2m
      )
    );

    expect(unitNodes.length).toBeGreaterThan(0);
  });

  it("recovers from completely malformed tool payloads", () => {
    const coerced = normaliseWeatherPayload({
      current: { temperature_2m: 11 },
      hourly: null,
      daily: "not-a-structure" as unknown as WeatherAtLocation["daily"],
    });

    expect(coerced.hourly.temperature_2m.length).toBeGreaterThan(0);
    expect(coerced.daily.sunrise.length).toBeGreaterThan(0);
  });
});
