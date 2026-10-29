import { describe, expect, it } from "vitest";

import type { DailyWeather, Ulid, WaterSource } from "@galaxy-farm/core";
import type { Planting } from "@galaxy-farm/module-garden";

import { isForecastDay, weatherJobs } from "../lib/weather-jobs.js";

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
