import { describe, expect, it } from "vitest";

import type { DailyWeather, Ulid, WaterSource } from "@galaxy-farm/core";
import type { Planting } from "@galaxy-farm/module-garden";

import { choreWeatherDay, isForecastDay, weatherJobs } from "../lib/weather-jobs.js";

/**
 * The jobs the weather decides (spec §6).
 *
 * The whole point is that a cover being off is not a job by itself: it is one
 * on the day before a forecast freeze and on no other day. Forecast days are
 * built the way the provider sends them — bare dates, which read as UTC
 * midnight — and "now" in local time, so the tests mean the same thing in
 * whatever time zone they run.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ZONE = "01ARZ3NDEKTSV4RRFFQ69G5Z01" as Ulid;
const NORTH = "01ARZ3NDEKTSV4RRFFQ69G5W01" as Ulid;
const SOUTH = "01ARZ3NDEKTSV4RRFFQ69G5W02" as Ulid;

// Mid-afternoon on 14 Jan, local time.
const NOW = new Date(2026, 0, 14, 15, 0);
const SETTINGS = { frostF: 36, hardFreezeF: 28 };

function tank(id: Ulid, name: string, extra: Partial<WaterSource> = {}): WaterSource {
  return {
    id,
    propertyId: PROPERTY,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    name,
    type: "tank",
    hasHeater: false,
    cover: "off",
    active: true,
    ...extra,
  } as WaterSource;
}

const ZONES = [{ id: ZONE, name: "Pen 1", waterSourceIds: [NORTH, SOUTH], active: true }];

function days(lows: Record<string, number>): DailyWeather[] {
  return Object.entries(lows).map(([date, lowF]) => ({
    date: new Date(date),
    lowF,
    highF: lowF + 20,
  })) as DailyWeather[];
}

function jobs(lows: Record<string, number> | undefined, extra: { plantings?: Planting[] } = {}) {
  return weatherJobs({
    forecast: lows === undefined ? undefined : { daily: days(lows), hourly: [] },
    settings: SETTINGS,
    water: [tank(NORTH, "North tank"), tank(SOUTH, "South tank", { hasHeater: true })],
    zones: ZONES,
    plantings: extra.plantings ?? [],
    now: NOW,
  });
}

describe("reading the forecast's days", () => {
  it("matches a bare forecast date to the same calendar day here", () => {
    expect(isForecastDay(new Date("2026-01-14"), NOW)).toBe(true);
    expect(isForecastDay(new Date("2026-01-15"), NOW)).toBe(false);
  });
});

describe("tank covers", () => {
  it("asks for the covers only the day before a forecast freeze", () => {
    const mild = jobs({ "2026-01-14": 40, "2026-01-15": 41, "2026-01-16": 45 });
    expect(mild.covers).toBeUndefined();
    expect(mild.coversOff).toBe(2);
    expect(mild.nextFreezeOn).toBeUndefined();

    const tonight = jobs({ "2026-01-14": 40, "2026-01-15": 25, "2026-01-16": 30 });
    expect(tonight.covers?.targets.map((target) => target.waterSource.name)).toEqual([
      "North tank",
      "South tank",
    ]);
    expect(tonight.covers?.lowF).toBe(25);
  });

  it("waits when the freeze is later in the week, and says when", () => {
    const later = jobs({ "2026-01-14": 40, "2026-01-15": 38, "2026-01-17": 22 });
    expect(later.covers).toBeUndefined();
    expect(later.nextFreezeOn?.toISOString().slice(0, 10)).toBe("2026-01-17");
  });

  it("decides nothing about the weather without a forecast", () => {
    const offline = jobs(undefined);
    expect(offline.known).toBe(false);
    expect(offline.covers).toBeUndefined();
    expect(offline.ice).toBeUndefined();
  });
});

describe("ice", () => {
  it("checks the tanks on a freezing morning and names the bare one", () => {
    const morning = jobs({ "2026-01-14": 24, "2026-01-15": 40 });
    expect(morning.ice?.targets).toHaveLength(2);
    expect(morning.ice?.bare.map((target) => target.waterSource.name)).toEqual(["North tank"]);
    // Tonight is mild, so there is nothing to put a cover on for.
    expect(morning.covers).toBeUndefined();
  });

  it("has nothing to check on a mild day", () => {
    expect(jobs({ "2026-01-14": 40 }).ice).toBeUndefined();
  });
});

describe("garden frost", () => {
  const planting = (extra: Partial<Planting>): Planting =>
    ({
      id: "01ARZ3NDEKTSV4RRFFQ69G5P01",
      propertyId: PROPERTY,
      bedId: "01ARZ3NDEKTSV4RRFFQ69G5B01",
      varietyId: "01ARZ3NDEKTSV4RRFFQ69G5V01",
      method: "transplant",
      status: "growing",
      plantedOn: new Date("2025-12-01"),
      ...extra,
    }) as Planting;

  it("asks for row cover on a frost night when something is in the ground", () => {
    const frost = jobs({ "2026-01-15": 34 }, { plantings: [planting({})] });
    expect(frost.frost).toEqual({ plantings: 1, lowF: 34, hardFreeze: false });
  });

  it("stays quiet with nothing planted out, or on a mild night", () => {
    const indoors = planting({ method: "indoor_start", plantedOn: undefined });
    expect(jobs({ "2026-01-15": 34 }, { plantings: [indoors] }).frost).toBeUndefined();
    expect(
      jobs({ "2026-01-15": 34 }, { plantings: [planting({ status: "finished" })] }).frost,
    ).toBeUndefined();
    expect(jobs({ "2026-01-15": 45 }, { plantings: [planting({})] }).frost).toBeUndefined();
  });
});

describe("before rain and before high winds", () => {
  // Hours arrive on the farm's own clock, read as UTC — the same convention
  // as the days — so "15:00Z" here is three in the afternoon at the farm.
  const hour = (at: string, extra: Record<string, number>) => ({
    at: new Date(`${at}:00Z`),
    temperatureF: 50,
    ...extra,
  });
  const forecast = (hourly: ReturnType<typeof hour>[], daily = days({ "2026-01-14": 40 })) => ({
    daily: daily.map((day) => ({ ...day, precipitationChance: 0 })),
    hourly,
  });
  const read = (
    shape: ReturnType<typeof forecast>,
    alerts = [] as Parameters<typeof choreWeatherDay>[3],
  ) => choreWeatherDay(shape, SETTINGS, NOW, alerts);

  it("says when rain arrives this afternoon, so the chore can beat it", () => {
    const day = read(
      forecast([
        hour("2026-01-14T09:00", { precipitationChance: 10 }),
        hour("2026-01-14T15:00", { precipitationChance: 70 }),
      ]),
    );
    expect(day.weather?.has("rain_coming")).toBe(true);
    expect(day.arrives.rain_coming).toEqual(new Date(2026, 0, 14, 15));
  });

  it("puts rain due tomorrow morning on this evening, with no earlier deadline", () => {
    const day = read(forecast([hour("2026-01-15T07:00", { precipitationChance: 80 })]));
    expect(day.weather?.has("rain_coming")).toBe(true);
    expect(day.arrives.rain_coming).toBeUndefined();
  });

  it("ignores rain after noon tomorrow — that is tomorrow's job", () => {
    const day = read(forecast([hour("2026-01-15T16:00", { precipitationChance: 90 })]));
    expect(day.weather?.has("rain_coming")).toBe(false);
  });

  it("reads high winds off the gusts, not only the mean", () => {
    const gusty = read(forecast([hour("2026-01-14T13:00", { windMph: 15, gustMph: 45 })]));
    expect(gusty.weather?.has("wind_coming")).toBe(true);
    expect(gusty.arrives.wind_coming).toEqual(new Date(2026, 0, 14, 13));

    const breezy = read(forecast([hour("2026-01-14T13:00", { windMph: 15, gustMph: 30 })]));
    expect(breezy.weather?.has("wind_coming")).toBe(false);
  });

  it("takes the weather service's warning even when the hours look calm", () => {
    const day = read(forecast([hour("2026-01-14T13:00", { windMph: 8 })]), [
      {
        id: "a1",
        event: "Severe Thunderstorm Warning",
        severity: "severe",
        from: new Date(2026, 0, 14, 17, 30),
        to: new Date(2026, 0, 14, 19),
      },
    ]);
    expect(day.weather?.has("wind_coming")).toBe(true);
    expect(day.weather?.has("rain_coming")).toBe(true);
    expect(day.arrives.wind_coming).toEqual(new Date(2026, 0, 14, 17, 30));
  });

  it("falls back to the day's chance when the forecast has no hours", () => {
    const shape = {
      daily: [
        { date: new Date("2026-01-14"), lowF: 40, highF: 60, precipitationChance: 20 },
        { date: new Date("2026-01-15"), lowF: 42, highF: 55, precipitationChance: 70 },
      ],
      hourly: [],
    };
    expect(choreWeatherDay(shape, SETTINGS, NOW).weather?.has("rain_coming")).toBe(true);
  });
});
