import { describe, expect, it, vi } from "vitest";

import {
  MAX_FORECAST_DAYS,
  openMeteoProvider,
  openMeteoUrl,
  parseOpenMeteo,
} from "../src/open-meteo.js";
import { nwsProvider, parseNwsAlerts, periodsToDaily } from "../src/nws.js";
import { combinedWeather } from "../src/index.js";

/**
 * The two weather adapters (spec §6).
 *
 * Parsing is tested against fixtures rather than the live services: CI has no
 * business depending on weather.gov being up, and the shapes below are the
 * ones both APIs actually return.
 */

const REQUEST = { latitude: 33.05, longitude: -97.47, days: 7 };

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

describe("openMeteoUrl", () => {
  it("asks for surface pressure, which is what the calving watch reads", () => {
    expect(openMeteoUrl(REQUEST)).toContain("surface_pressure");
  });

  it("asks the service for Fahrenheit rather than converting here", () => {
    // A unit conversion in two places is a unit conversion that disagrees with
    // itself.
    expect(openMeteoUrl(REQUEST)).toContain("temperature_unit=fahrenheit");
  });

  it("clamps the horizon instead of sending a request the API will reject", () => {
    expect(openMeteoUrl({ ...REQUEST, days: 60 })).toContain(`forecast_days=${MAX_FORECAST_DAYS}`);
    expect(openMeteoUrl({ ...REQUEST, days: 0 })).toContain("forecast_days=1");
  });
});

describe("parseOpenMeteo", () => {
  const body = {
    hourly: {
      time: ["2026-11-20T00:00", "2026-11-20T01:00", "2026-11-20T02:00"],
      temperature_2m: [42, null, 39],
      surface_pressure: [1018.2, 1017.5, null],
      wind_speed_10m: [8, 9, 10],
      precipitation_probability: [10, null, 30],
    },
    daily: {
      time: ["2026-11-20", "2026-11-21"],
      temperature_2m_min: [31, null],
      temperature_2m_max: [55, 48],
      precipitation_probability_max: [30, 60],
    },
  };

  it("reads the hours it can and drops the ones with no temperature", () => {
    const forecast = parseOpenMeteo(body, REQUEST, new Date("2026-11-19T12:00:00Z"));
    expect(forecast.hourly.map((hour) => hour.temperatureF)).toEqual([42, 39]);
  });

  it("leaves a missing pressure absent rather than zero", () => {
    // Open-Meteo returns null for a variable it has no value for, and 0 hPa
    // would read as the steepest pressure fall ever recorded.
    const forecast = parseOpenMeteo(body, REQUEST, new Date());
    expect(forecast.hourly[1]?.pressureHpa).toBeUndefined();
    expect(forecast.hourly[0]?.pressureHpa).toBe(1018.2);
  });

  it("drops a day missing either end of its range", () => {
    const forecast = parseOpenMeteo(body, REQUEST, new Date());
    expect(forecast.daily).toHaveLength(1);
    expect(forecast.daily[0]?.lowF).toBe(31);
  });

  it("survives a response with nothing in it", () => {
    const forecast = parseOpenMeteo({}, REQUEST, new Date());
    expect(forecast.hourly).toEqual([]);
    expect(forecast.daily).toEqual([]);
  });

  it("records where and when, so a cached forecast can say how stale it is", () => {
    const at = new Date("2026-11-19T12:00:00Z");
    const forecast = parseOpenMeteo(body, REQUEST, at);

    expect(forecast.latitude).toBe(33.05);
    expect(forecast.retrievedAt).toBe(at);
  });
});

describe("openMeteoProvider", () => {
  it("fetches and parses", async () => {
    const fetcher = vi.fn(async () =>
      okResponse({
        daily: { time: ["2026-11-20"], temperature_2m_min: [28], temperature_2m_max: [45] },
      }),
    );

    const forecast = await openMeteoProvider({ fetch: fetcher as never }).forecast(REQUEST);
    expect(forecast.daily[0]?.lowF).toBe(28);
  });

  it("throws on a non-ok response rather than returning an empty forecast", async () => {
    // An empty forecast reads as "no freeze coming", which is the wrong thing
    // to conclude from a service being down.
    const fetcher = vi.fn(
      async () => ({ ok: false, status: 429, statusText: "Too Many Requests" }) as Response,
    );

    await expect(openMeteoProvider({ fetch: fetcher as never }).forecast(REQUEST)).rejects.toThrow(
      /429/,
    );
  });
});

describe("periodsToDaily", () => {
  it("folds NWS day and night periods into one row", () => {
    const daily = periodsToDaily([
      { startTime: "2026-11-20T06:00:00-06:00", isDaytime: true, temperature: 55 },
      { startTime: "2026-11-20T18:00:00-06:00", isDaytime: false, temperature: 31 },
    ]);

    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ lowF: 31, highF: 55 });
  });

  it("drops a day with only one half of the pair", () => {
    // Fabricating the missing end would put a made-up low in front of somebody
    // deciding whether to break ice.
    const daily = periodsToDaily([
      { startTime: "2026-11-21T06:00:00-06:00", isDaytime: true, temperature: 50 },
    ]);

    expect(daily).toEqual([]);
  });

  it("keeps the higher precipitation chance of the two halves", () => {
    const daily = periodsToDaily([
      {
        startTime: "2026-11-20T06:00:00-06:00",
        isDaytime: true,
        temperature: 55,
        probabilityOfPrecipitation: { value: 20 },
      },
      {
        startTime: "2026-11-20T18:00:00-06:00",
        isDaytime: false,
        temperature: 31,
        probabilityOfPrecipitation: { value: 70 },
      },
    ]);

    expect(daily[0]?.precipitationChance).toBe(70);
  });
});

describe("parseNwsAlerts", () => {
  it("reads an active warning", () => {
    const alerts = parseNwsAlerts({
      features: [
        {
          id: "urn:oid:2.49.0.1.840.0.abc",
          properties: {
            event: "Hard Freeze Warning",
            headline: "Hard Freeze Warning until 9 AM CST",
            severity: "Severe",
            onset: "2026-12-01T00:00:00-06:00",
            ends: "2026-12-01T09:00:00-06:00",
          },
        },
      ],
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.event).toBe("Hard Freeze Warning");
    expect(alerts[0]?.severity).toBe("severe");
  });

  it("falls back to the effective time when there is no onset", () => {
    const alerts = parseNwsAlerts({
      features: [{ properties: { event: "Wind Advisory", effective: "2026-12-01T00:00:00Z" } }],
    });

    expect(alerts[0]?.from).toEqual(new Date("2026-12-01T00:00:00Z"));
  });

  it("calls an unrecognised severity unknown rather than guessing", () => {
    const alerts = parseNwsAlerts({
      features: [
        { properties: { event: "Test", severity: "Whatever", onset: "2026-12-01T00:00:00Z" } },
      ],
    });

    expect(alerts[0]?.severity).toBe("unknown");
  });

  it("skips a feature with no event or no start", () => {
    expect(parseNwsAlerts({ features: [{ properties: {} }] })).toEqual([]);
  });

  it("survives an empty response", () => {
    expect(parseNwsAlerts({})).toEqual([]);
  });
});

describe("nwsProvider", () => {
  const point = { properties: { forecast: "https://api.weather.gov/gridpoints/FWD/1,2/forecast" } };
  const forecastBody = {
    properties: {
      periods: [
        { startTime: "2026-11-20T06:00:00-06:00", isDaytime: true, temperature: 55 },
        { startTime: "2026-11-20T18:00:00-06:00", isDaytime: false, temperature: 31 },
      ],
    },
  };

  it("resolves the grid point before asking for the forecast", async () => {
    // NWS is grid-based: the forecast URL comes back in the point response
    // rather than being constructed.
    const fetcher = vi.fn(async (url: string) =>
      okResponse(url.includes("/points/") ? point : forecastBody),
    );

    const forecast = await nwsProvider({ fetch: fetcher as never }).forecast(REQUEST);

    expect(fetcher.mock.calls[0]?.[0]).toContain("/points/33.05,-97.47");
    expect(forecast.daily[0]?.lowF).toBe(31);
  });

  it("publishes no hourly series, and says so by returning an empty one", async () => {
    const fetcher = vi.fn(async (url: string) =>
      okResponse(url.includes("/points/") ? point : forecastBody),
    );

    const forecast = await nwsProvider({ fetch: fetcher as never }).forecast(REQUEST);
    expect(forecast.hourly).toEqual([]);
  });

  it("identifies itself, because NWS refuses anonymous callers", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      return okResponse(url.includes("/points/") ? point : forecastBody);
    });

    await nwsProvider({ fetch: fetcher as never }).forecast(REQUEST);

    const headers = fetcher.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBeDefined();
  });

  it("says plainly when a point has no forecast", async () => {
    const fetcher = vi.fn(async () => okResponse({ properties: {} }));

    await expect(nwsProvider({ fetch: fetcher as never }).forecast(REQUEST)).rejects.toThrow(
      /outside the US/,
    );
  });
});

describe("combinedWeather", () => {
  const forecaster = {
    name: "primary",
    forecast: async () => ({
      latitude: 0,
      longitude: 0,
      retrievedAt: new Date(),
      hourly: [],
      daily: [],
    }),
  };

  it("does not lose the forecast when the alert service is down", async () => {
    // The forecast is what the freeze chores and the calving watch are built
    // from. Losing it because weather.gov was slow is the wrong trade on the
    // night it matters.
    const failing = {
      name: "alerts",
      forecast: forecaster.forecast,
      alerts: async () => {
        throw new Error("gateway timeout");
      },
    };

    const combined = combinedWeather(forecaster, failing);

    await expect(combined.forecast(REQUEST)).resolves.toBeDefined();
    await expect(combined.alerts(REQUEST)).resolves.toEqual([]);
  });

  it("returns no alerts from a provider that has none to give", async () => {
    const combined = combinedWeather(forecaster, forecaster);
    await expect(combined.alerts(REQUEST)).resolves.toEqual([]);
  });

  it("passes alerts through when they arrive", async () => {
    const alert = {
      id: "a",
      event: "Hard Freeze Warning",
      severity: "severe" as const,
      from: new Date(),
    };
    const combined = combinedWeather(forecaster, {
      name: "alerts",
      forecast: forecaster.forecast,
      alerts: async () => [alert],
    });

    await expect(combined.alerts(REQUEST)).resolves.toEqual([alert]);
  });
});
