import { describe, expect, it } from "vitest";

import {
  fullMoonNear,
  illumination,
  isNearFullMoon,
  lunationFraction,
  moonPhase,
  SYNODIC_MONTH_DAYS,
} from "../src/weather/moon.js";
import {
  DEFAULT_CALF_CHILL_F,
  DEFAULT_HARD_FREEZE_F,
  freezeChores,
  freezeDays,
  frostRisk,
  hpaToInHg,
  isColdSnap,
  isRapidPressureFall,
  steepestPressureFall,
} from "../src/weather/thresholds.js";
import type { DailyWeather, HourlyWeather } from "../src/ports/weather.js";
import type { WaterSource } from "../src/entities/water-source.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * Weather signals (spec §6).
 *
 * The freeze chore test is the one that matters most: this property has four
 * tanks serving eight zones, and deriving the chore per zone would send
 * somebody to the Pen 1/2 trough three times on a freeze day.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");

describe("moon phase", () => {
  it("finds the full moon of a known lunation", () => {
    // 2026-11-24 is a full moon. The mean-phase calculation should land within
    // a few hours of it, which is all a ±1 day window needs.
    const found = fullMoonNear(new Date("2026-11-24T00:00:00Z"));
    const hoursOff = Math.abs(found.getTime() - Date.UTC(2026, 10, 24, 14, 53)) / 3_600_000;

    expect(hoursOff).toBeLessThan(18);
  });

  it("runs 0 at new moon and 0.5 at full", () => {
    const newMoon = new Date(Date.UTC(2000, 0, 6, 18, 14));
    expect(lunationFraction(newMoon)).toBeCloseTo(0, 3);
    expect(moonPhase(newMoon)).toBe("new");

    const full = new Date(newMoon.getTime() + (SYNODIC_MONTH_DAYS / 2) * 86_400_000);
    expect(lunationFraction(full)).toBeCloseTo(0.5, 3);
    expect(moonPhase(full)).toBe("full");
  });

  it("wraps rather than going negative before the epoch", () => {
    // Dates before 2000 are perfectly ordinary — a cow's records could predate
    // it — and a negative fraction would name the wrong phase for all of them.
    const fraction = lunationFraction(new Date("1995-06-01T00:00:00Z"));
    expect(fraction).toBeGreaterThanOrEqual(0);
    expect(fraction).toBeLessThan(1);
  });

  it("lights the disc fully at full and not at all at new", () => {
    const newMoon = new Date(Date.UTC(2000, 0, 6, 18, 14));
    expect(illumination(newMoon)).toBeCloseTo(0, 3);
    expect(
      illumination(new Date(newMoon.getTime() + (SYNODIC_MONTH_DAYS / 2) * 86_400_000)),
    ).toBeCloseTo(1, 3);
  });

  it("names every phase across one lunation", () => {
    const start = Date.UTC(2000, 0, 6, 18, 14);
    const seen = new Set<string>();
    for (let day = 0; day < 30; day += 0.25) {
      seen.add(moonPhase(new Date(start + day * 86_400_000)));
    }

    expect(seen.size).toBe(8);
  });

  it("answers the question §6 actually asks", () => {
    const full = fullMoonNear(new Date("2026-11-24T00:00:00Z"));
    expect(isNearFullMoon(full, 1)).toBe(true);
    expect(isNearFullMoon(new Date(full.getTime() + 5 * 86_400_000), 1)).toBe(false);
  });

  it("looks backwards when the full moon has just passed", () => {
    const full = fullMoonNear(new Date("2026-11-24T00:00:00Z"));
    const dayAfter = new Date(full.getTime() + 20 * 3_600_000);

    expect(fullMoonNear(dayAfter).getTime()).toBe(full.getTime());
  });
});

// ---------------------------------------------------------------- thresholds

const day = (date: string, lowF: number, highF = lowF + 20): DailyWeather => ({
  date: new Date(date),
  lowF,
  highF,
});

const hour = (at: string, temperatureF: number, pressureHpa?: number): HourlyWeather => ({
  at: new Date(at),
  temperatureF,
  ...(pressureHpa === undefined ? {} : { pressureHpa }),
});

describe("frostRisk", () => {
  it("raises a night at or below the frost threshold", () => {
    const risks = frostRisk([day("2026-11-08", 34), day("2026-11-09", 48)]);
    expect(risks).toHaveLength(1);
    expect(risks[0]?.hardFreeze).toBe(false);
  });

  it("marks a hard freeze separately from a frost", () => {
    // The garden cares about 36; the tanks care about 28. One list, two flags.
    const [risk] = frostRisk([day("2026-12-01", 25)]);
    expect(risk?.hardFreeze).toBe(true);
    expect(DEFAULT_HARD_FREEZE_F).toBe(28);
  });
});

describe("freezeDays", () => {
  it("counts a night crossing the hard-freeze threshold", () => {
    expect(freezeDays({ daily: [day("2026-12-01", 26)], hourly: [] })).toHaveLength(1);
  });

  it("counts a sustained spell below freezing that never reaches 28", () => {
    // A still day at 30 °F freezes a trough that a night dipping to 27 and
    // recovering by nine does not.
    const hourly = Array.from({ length: 10 }, (_, index) =>
      hour(`2026-12-02T${String(index).padStart(2, "0")}:00:00Z`, 30),
    );

    expect(freezeDays({ daily: [day("2026-12-02", 30)], hourly })).toHaveLength(1);
  });

  it("leaves a brief dip alone", () => {
    const hourly = [hour("2026-12-03T05:00:00Z", 31), hour("2026-12-03T06:00:00Z", 31)];
    expect(freezeDays({ daily: [day("2026-12-03", 31)], hourly })).toEqual([]);
  });
});

describe("freezeChores", () => {
  const source = (n: number, over: Partial<WaterSource> = {}): WaterSource => ({
    id: id(n),
    propertyId: id(0),
    createdAt: AT,
    updatedAt: AT,
    name: `Tank ${n}`,
    type: "auto_refill",
    hasHeater: false,
    active: true,
    ...over,
  });

  // The real layout: four tanks, eight zones, one tank serving three.
  const sources = [source(1), source(2), source(3), source(4, { active: false })];
  const zone = (n: number, source: number) => ({
    id: id(n),
    name: `Zone ${n}`,
    active: true,
    waterSourceIds: [id(source)],
  });
  const zones = [
    zone(10, 1),
    zone(11, 1),
    zone(12, 2),
    zone(13, 2),
    zone(14, 2),
    zone(15, 3),
    zone(16, 3),
    zone(17, 4),
  ];

  it("raises one chore per tank, not one per zone", () => {
    // Eight zones, three active tanks. Per-zone this would be seven chores and
    // three trips to the same trough.
    const chores = freezeChores({ daily: [day("2026-12-01", 25)], hourly: [] }, sources, zones);

    expect(chores).toHaveLength(3);
  });

  it("names every zone a tank serves, so nobody wonders which trough", () => {
    const chores = freezeChores({ daily: [day("2026-12-01", 25)], hourly: [] }, sources, zones);
    const shared = chores.find((chore) => chore.target.waterSource.id === id(2));

    expect(shared?.target.zones).toHaveLength(3);
  });

  it("raises nothing for a seasonal tank that is stowed", () => {
    const chores = freezeChores({ daily: [day("2026-12-01", 25)], hourly: [] }, sources, zones);
    expect(chores.some((chore) => chore.target.waterSource.id === id(4))).toBe(false);
  });

  it("calls every tank here vulnerable, because not one has a heater", () => {
    const chores = freezeChores({ daily: [day("2026-12-01", 25)], hourly: [] }, sources, zones);
    expect(chores.every((chore) => chore.target.vulnerable)).toBe(true);
  });

  it("raises a set per freeze day, not one for the whole cold spell", () => {
    const chores = freezeChores(
      { daily: [day("2026-12-01", 25), day("2026-12-02", 24)], hourly: [] },
      sources,
      zones,
    );

    expect(chores).toHaveLength(6);
  });
});

describe("pressure", () => {
  it("measures the deepest fall across a rolling 24 hours", () => {
    // Not the steepest single hour: the signal is the depth of the whole fall.
    const hourly = [
      hour("2026-11-19T00:00:00Z", 60, 1020),
      hour("2026-11-19T12:00:00Z", 58, 1017),
      hour("2026-11-19T23:00:00Z", 52, 1014),
      hour("2026-11-20T12:00:00Z", 40, 1010),
    ];

    expect(steepestPressureFall(hourly)).toBeCloseTo(7, 5);
  });

  it("does not compare readings more than a day apart", () => {
    const hourly = [hour("2026-11-19T00:00:00Z", 60, 1020), hour("2026-11-22T00:00:00Z", 40, 1000)];

    expect(steepestPressureFall(hourly)).toBe(0);
  });

  it("ignores a rise", () => {
    const hourly = [hour("2026-11-19T00:00:00Z", 60, 1000), hour("2026-11-19T12:00:00Z", 62, 1020)];
    expect(steepestPressureFall(hourly)).toBe(0);
  });

  it("skips hours with no pressure reading rather than treating them as zero", () => {
    // A missing reading as 0 hPa would be the steepest fall ever recorded.
    const hourly = [
      hour("2026-11-19T00:00:00Z", 60, 1020),
      hour("2026-11-19T06:00:00Z", 58),
      hour("2026-11-19T12:00:00Z", 55, 1017),
    ];

    expect(steepestPressureFall(hourly)).toBeCloseTo(3, 5);
  });

  it("fires at §6's threshold", () => {
    const hourly = [hour("2026-11-19T00:00:00Z", 60, 1020), hour("2026-11-19T12:00:00Z", 55, 1016)];
    expect(isRapidPressureFall(hourly)).toBe(true);
    expect(isRapidPressureFall(hourly, 5)).toBe(false);
  });

  it("converts to the inches of mercury §6 quotes", () => {
    expect(hpaToInHg(4)).toBeCloseTo(0.118, 3);
  });
});

describe("isColdSnap", () => {
  it("fires at the calf-chill threshold", () => {
    expect(DEFAULT_CALF_CHILL_F).toBe(20);
    expect(isColdSnap([day("2026-12-01", 18)])).toBe(true);
    expect(isColdSnap([day("2026-12-01", 26)])).toBe(false);
  });
});
