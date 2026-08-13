import { describe, expect, it } from "vitest";

import {
  coverChoreTitle,
  coversToFit,
  freezeCheckTargets,
  freezeChoreTitle,
  vulnerableToFreezing,
  waterSourceSchema,
  type WaterSource,
  type ZoneWaterRef,
} from "../src/entities/water-source.js";
import { encodeUlid, type Ulid } from "../src/types/ids.js";

/**
 * The real layout drives these tests, because the bug they prevent is a real
 * one: four tanks serve eight zones here, and a per-zone derivation would send
 * someone to the same trough twice on the coldest morning of the year.
 */

let counter = 0;
const nextId = (): Ulid => encodeUlid(7_000 + counter++, () => 0.5);

const propertyId = nextId();
const at = new Date("2026-11-20T06:00:00Z");

const TANK_PASTURE = nextId();
const TANK_PEN_12 = nextId();
const TANK_PEN_AB = nextId();
const TANK_WEST = nextId();

const source = (id: Ulid, name: string, overrides: Partial<WaterSource> = {}): WaterSource =>
  ({
    id,
    propertyId,
    createdAt: at,
    updatedAt: at,
    name,
    type: "auto_refill",
    hasHeater: false,
    active: true,
    ...overrides,
  }) as WaterSource;

const zone = (name: string, waterSourceIds: Ulid[], active = true): ZoneWaterRef => ({
  id: nextId(),
  name,
  active,
  waterSourceIds,
});

/** The place as it actually is: four tanks, none heated. */
const sources = [
  source(TANK_PASTURE, "Pasture tank"),
  source(TANK_PEN_12, "Pen 1/2 tank"),
  source(TANK_PEN_AB, "Pen A/B tank"),
  source(TANK_WEST, "West Pen tank", { type: "static_tank" }),
];

const zones = [
  zone("Pasture", [TANK_PASTURE]),
  zone("Hay Field", [TANK_PASTURE]),
  zone("Pen 1", [TANK_PEN_12]),
  zone("2nd Pen", [TANK_PEN_12]),
  zone("Randy's Pasture", [TANK_PEN_12]),
  zone("Pen A", [TANK_PEN_AB]),
  zone("Pen B", [TANK_PEN_AB]),
  zone("West Pen", [TANK_WEST]),
];

describe("WaterSource", () => {
  it("validates", () => {
    expect(waterSourceSchema.safeParse(source(TANK_PASTURE, "Pasture tank")).success).toBe(true);
  });

  it("requires a name, since the chore says which tank to walk to", () => {
    expect(waterSourceSchema.safeParse(source(TANK_PASTURE, "")).success).toBe(false);
  });

  it("reads a tank recorded before covers existed as having none", () => {
    // Not a nicety. A required enum here would refuse the first edit to every
    // tank already sitting in a device's store, and "nobody has said" is
    // honestly "none" — it is the answer that raises no chore.
    const parsed = waterSourceSchema.safeParse(source(TANK_PASTURE, "Pasture tank"));

    expect(parsed.success && parsed.data.cover).toBe("none");
  });

  it("refuses a cover state that is not one of the three", () => {
    const parsed = waterSourceSchema.safeParse({
      ...source(TANK_PASTURE, "Pasture tank"),
      cover: "maybe",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("covers — the job that has to happen before the freeze, not during it", () => {
  const covered = (cover: WaterSource["cover"]) =>
    freezeCheckTargets(
      [source(TANK_PASTURE, "Pasture tank", { cover })],
      [zone("Pasture", [TANK_PASTURE])],
    );

  it("asks for the cover that exists and is off", () => {
    const targets = covered("off");

    expect(targets[0]?.needsCover).toBe(true);
    expect(coversToFit(targets)).toHaveLength(1);
    expect(coverChoreTitle(targets[0]!)).toBe("Put the cover on Pasture tank — serves Pasture");
  });

  it("asks for nothing once it is on", () => {
    expect(coversToFit(covered("on"))).toEqual([]);
  });

  it("asks for nothing from a tank that has no cover to put on", () => {
    // The distinction the three states exist for: a chore telling somebody to
    // fit a cover that does not exist is a chore they learn to skip, and a
    // list with one of those in it is a list read less carefully.
    expect(coversToFit(covered("none"))).toEqual([]);
  });

  it("still wants the morning check on a covered tank", () => {
    // A cover slows ice. It does not stop it, and a screen that said otherwise
    // would be the reason nobody walked out to look.
    const [target] = covered("on");

    expect(target?.vulnerable).toBe(true);
    expect(freezeChoreTitle(target!)).toBe(
      "Lift the cover and check Pasture tank — serves Pasture",
    );
  });

  it("raises no cover chore for a tank that is stowed for the season", () => {
    const targets = freezeCheckTargets(
      [source(TANK_WEST, "West Pen tank", { cover: "off", active: false })],
      [zone("West Pen", [TANK_WEST])],
    );

    expect(coversToFit(targets)).toEqual([]);
  });
});

describe("freeze-day chores — one per tank, not one per zone", () => {
  it("produces four chores for eight zones", () => {
    // The bug this modelling exists to prevent: per-zone, this would be eight.
    const targets = freezeCheckTargets(sources, zones);

    expect(targets).toHaveLength(4);
  });

  it("collapses three zones sharing one tank into a single chore", () => {
    const targets = freezeCheckTargets(sources, zones);
    const penTank = targets.find((t) => t.waterSource.id === TANK_PEN_12);

    expect(penTank?.zones.map((z) => z.name)).toEqual(["Pen 1", "2nd Pen", "Randy's Pasture"]);
  });

  it("names every zone the tank serves, so nobody has to guess where it is", () => {
    const targets = freezeCheckTargets(sources, zones);
    const penTank = targets.find((t) => t.waterSource.id === TANK_PEN_12);

    expect(freezeChoreTitle(penTank!)).toBe(
      "Break ice and check Pen 1/2 tank — serves Pen 1, 2nd Pen, Randy's Pasture",
    );
  });

  it("flags every tank here as vulnerable, because none of them is heated", () => {
    const targets = freezeCheckTargets(sources, zones);

    expect(vulnerableToFreezing(targets)).toHaveLength(4);
  });

  it("softens the wording for a heated tank", () => {
    const heated = [source(TANK_PASTURE, "Pasture tank", { hasHeater: true })];
    const [target] = freezeCheckTargets(heated, [zone("Pasture", [TANK_PASTURE])]);

    expect(target?.vulnerable).toBe(false);
    expect(freezeChoreTitle(target!)).toMatch(/^Check /);
  });

  it("raises nothing for a seasonal tank that is not currently out", () => {
    // West Pen only has water when someone puts a tank there.
    const stowed = sources.map((s) =>
      s.id === TANK_WEST ? source(TANK_WEST, "West Pen tank", { active: false }) : s,
    );

    const targets = freezeCheckTargets(stowed, zones);

    expect(targets).toHaveLength(3);
    expect(targets.some((t) => t.waterSource.id === TANK_WEST)).toBe(false);
  });

  it("raises nothing for a tank no zone drinks from", () => {
    const orphan = [source(nextId(), "Old tank by the barn")];

    expect(freezeCheckTargets(orphan, zones)).toEqual([]);
  });

  it("ignores inactive zones when deciding who a tank serves", () => {
    const targets = freezeCheckTargets(sources, [
      zone("Pen 1", [TANK_PEN_12]),
      zone("2nd Pen", [TANK_PEN_12], false),
    ]);

    expect(targets[0]?.zones.map((z) => z.name)).toEqual(["Pen 1"]);
  });

  it("drops a tank entirely once every zone it serves goes inactive", () => {
    const targets = freezeCheckTargets(sources, [zone("Pen 1", [TANK_PEN_12], false)]);

    expect(targets).toEqual([]);
  });

  it("handles a zone drinking from two sources", () => {
    const targets = freezeCheckTargets(sources, [zone("Pasture", [TANK_PASTURE, TANK_PEN_12])]);

    expect(targets).toHaveLength(2);
  });

  it("returns nothing when there is no water at all", () => {
    expect(freezeCheckTargets([], zones)).toEqual([]);
  });
});
