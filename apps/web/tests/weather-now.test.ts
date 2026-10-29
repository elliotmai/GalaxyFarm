import { describe, expect, it } from "vitest";

import { weatherCodeLabel } from "@galaxy-farm/core";

import { weatherNow } from "../lib/weather-now.js";

/**
 * The corner of every barn board: the temperature and the sky now, and what
 * is on its way. Hours and days arrive on the farm's clock, read as UTC.
 */

const NOW = new Date(2026, 0, 14, 13, 40);
const SETTINGS = { frostF: 36, hardFreezeF: 28 };

const forecast = (extra: Record<string, unknown> = {}) => ({
  latitude: 32.7,
  longitude: -97.3,
  retrievedAt: NOW,
  daily: [
    { date: new Date("2026-01-14"), lowF: 40, highF: 60 },
    { date: new Date("2026-01-15"), lowF: 34, highF: 52 },
  ],
  hourly: [
    { at: new Date("2026-01-14T13:00:00Z"), temperatureF: 51, weatherCode: 2 },
    { at: new Date("2026-01-14T17:00:00Z"), temperatureF: 47, precipitationChance: 80 },
  ],
  ...extra,
});

describe("the weather on a board", () => {
  it("says the temperature and the sky, from the provider's own now", () => {
    const now = weatherNow(
      forecast({ current: { at: NOW, temperatureF: 52.4, weatherCode: 3, gustMph: 31 } }),
      SETTINGS,
      [],
      NOW,
    );
    expect(now.temperatureF).toBe(52);
    expect(now.sky).toBe("Cloudy, gusts 31 mph");
  });

  it("falls back to the nearest hour when there is no reading now", () => {
    const now = weatherNow(forecast(), SETTINGS, [], NOW);
    expect(now.temperatureF).toBe(51);
    expect(now.sky).toBe("Partly cloudy");
  });

  it("says what is coming and when", () => {
    const now = weatherNow(forecast(), SETTINGS, [], NOW);
    expect(now.coming[0]).toMatch(/^Rain from 5/);
    expect(now.coming).toContain("Frost tonight");
  });

  it("says nothing at all without a forecast", () => {
    expect(weatherNow(undefined, SETTINGS, [], NOW)).toEqual({
      temperatureF: undefined,
      sky: undefined,
      coming: [],
    });
  });
});

describe("weather codes", () => {
  it("reads the WMO table in a word or two", () => {
    expect(weatherCodeLabel(0)).toBe("Clear");
    expect(weatherCodeLabel(63)).toBe("Rain");
    expect(weatherCodeLabel(95)).toBe("Thunderstorm");
    expect(weatherCodeLabel(42)).toBeUndefined();
    expect(weatherCodeLabel(undefined)).toBeUndefined();
  });
});
