import { describe, expect, it } from "vitest";

import {
  canContain,
  childrenOf,
  descendantsOf,
  groupedZones,
  isGroupingType,
  possibleGroupsFor,
  zoneSchema,
  type Zone,
  type ZoneType,
} from "../src/entities/zone.js";
import { encodeUlid, type Ulid } from "../src/types/ids.js";

/**
 * Grouping the place up (spec §5.1, added v1.5).
 *
 * Two containments that are one sentence — a stall is in a barn, a pen is in
 * the North end — so both are the same field. The tests that matter here are
 * the ones about what must *not* be offered: an area inside an area, a stall
 * loose in a field, or a barn put inside one of its own stalls.
 */

let counter = 0;
const nextId = (): Ulid => encodeUlid(9_000 + counter++, () => 0.5);
const at = new Date("2026-08-13T12:00:00Z");
const propertyId = nextId();

const zone = (name: string, type: ZoneType, parentZoneId?: Ulid): Zone =>
  ({
    id: nextId(),
    propertyId,
    createdAt: at,
    updatedAt: at,
    name,
    type,
    ...(parentZoneId === undefined ? {} : { parentZoneId }),
    indoor: false,
    baselineSafetyLevel: 2,
    waterSourceIds: [],
    resting: false,
    active: true,
  }) as Zone;

describe("what can hold what", () => {
  it("puts stalls in barns and nowhere else", () => {
    expect(canContain("barn", "stall")).toBe(true);
    expect(canContain("area", "stall")).toBe(false);
    expect(canContain("pasture", "stall")).toBe(false);
  });

  it("puts pens and pastures in an area", () => {
    expect(canContain("area", "pen")).toBe(true);
    expect(canContain("area", "pasture")).toBe(true);
  });

  it("lets a barn sit in an area, since a barn is somewhere on the place", () => {
    expect(canContain("area", "barn")).toBe(true);
  });

  it("refuses to nest one area inside another", () => {
    // "North contains South" is not a thing anybody means, and allowing it
    // turns a flat list of areas into a tree nobody asked to navigate.
    expect(canContain("area", "area")).toBe(false);
  });

  it("holds nothing inside a pasture or a pen", () => {
    expect(canContain("pasture", "pen")).toBe(false);
    expect(canContain("pen", "pen")).toBe(false);
  });

  it("names the two types that group things", () => {
    expect(isGroupingType("area")).toBe(true);
    expect(isGroupingType("barn")).toBe(true);
    expect(isGroupingType("pasture")).toBe(false);
  });
});

describe("the schema", () => {
  const pen = zone("Pen 1", "pen");

  it("accepts a zone with no group, because that is its own group", () => {
    expect(zoneSchema.safeParse(pen).success).toBe(true);
  });

  it("accepts an area", () => {
    expect(zoneSchema.safeParse(zone("North", "area")).success).toBe(true);
  });

  it("refuses a parent that is not an id", () => {
    expect(zoneSchema.safeParse({ ...pen, parentZoneId: "the north one" }).success).toBe(false);
  });
});

describe("possibleGroupsFor", () => {
  const north = zone("North", "area");
  const south = zone("South", "area");
  const barn = zone("Red Barn", "barn", north.id);
  const stall = zone("Stall 1", "stall", barn.id);
  const pen = zone("Pen 1", "pen");
  const zones = [north, south, barn, stall, pen];

  it("offers a stall the barns, by name, and nothing else", () => {
    // The point of a barn being a named zone: you put the stall in the Red
    // Barn, not in "a barn".
    expect(possibleGroupsFor(zones, stall).map((z) => z.name)).toEqual(["Red Barn"]);
  });

  it("offers a pen the areas and the barns", () => {
    expect(possibleGroupsFor(zones, pen).map((z) => z.name)).toEqual([
      "North",
      "Red Barn",
      "South",
    ]);
  });

  it("offers an area nothing, since areas do not nest", () => {
    expect(possibleGroupsFor(zones, south)).toEqual([]);
  });

  it("never offers a zone itself", () => {
    expect(possibleGroupsFor(zones, barn).some((z) => z.id === barn.id)).toBe(false);
  });

  it("never offers a zone something already inside it", () => {
    // Putting the Red Barn inside its own stall would strand both in a loop
    // no screen could draw and no walk could terminate on.
    const offered = possibleGroupsFor(zones, barn).map((z) => z.name);

    expect(offered).toEqual(["North", "South"]);
    expect(offered).not.toContain("Stall 1");
  });

  it("leaves a retired area out of the picker", () => {
    const retired = { ...south, active: false } as Zone;

    expect(possibleGroupsFor([north, retired, pen], pen).map((z) => z.name)).toEqual(["North"]);
  });
});

describe("childrenOf and descendantsOf", () => {
  const north = zone("North", "area");
  const barn = zone("Red Barn", "barn", north.id);
  const stallB = zone("Stall 2", "stall", barn.id);
  const stallA = zone("Stall 1", "stall", barn.id);
  const zones = [north, barn, stallB, stallA];

  it("lists what sits directly inside, in name order", () => {
    expect(childrenOf(zones, barn.id).map((z) => z.name)).toEqual(["Stall 1", "Stall 2"]);
    expect(childrenOf(zones, north.id).map((z) => z.name)).toEqual(["Red Barn"]);
  });

  it("reaches all the way down", () => {
    expect(
      descendantsOf(zones, north.id)
        .map((z) => z.name)
        .sort(),
    ).toEqual(["Red Barn", "Stall 1", "Stall 2"]);
  });

  it("terminates on a cycle rather than hanging", () => {
    // `canContain` permits no loop, so this is the bad-import case. A page
    // that hangs is worse than a page that is wrong, because nobody can tell
    // what it is doing.
    const a = zone("A", "area");
    const b = { ...zone("B", "barn", a.id) } as Zone;
    const looped = [{ ...a, parentZoneId: b.id } as Zone, b];

    expect(descendantsOf(looped, looped[0]!.id).map((z) => z.name)).toEqual(["B"]);
  });
});

describe("groupedZones", () => {
  const north = zone("North", "area");
  const south = zone("South", "area");
  const barn = zone("Red Barn", "barn");
  const hay = zone("Hay Field", "pasture", north.id);
  const pasture = zone("Pasture", "pasture", north.id);
  const penA = zone("Pen A", "pen", south.id);
  const stall = zone("Stall 1", "stall", barn.id);
  const west = zone("West Pen", "pen");
  const tub = zone("Tub / chute", "working_facility");

  const zones = [north, south, barn, hay, pasture, penA, stall, west, tub];

  it("reads as somebody would say it: North, the barn, South, then the rest", () => {
    const grouped = groupedZones(zones);

    expect(grouped.map((entry) => entry.group?.name)).toEqual([
      "North",
      "Red Barn",
      "South",
      undefined,
    ]);
  });

  it("puts each group's members under it, in name order", () => {
    const grouped = groupedZones(zones);
    const byName = (name: string) => grouped.find((entry) => entry.group?.name === name);

    expect(byName("North")?.members.map((z) => z.name)).toEqual(["Hay Field", "Pasture"]);
    expect(byName("Red Barn")?.members.map((z) => z.name)).toEqual(["Stall 1"]);
  });

  it("collects the ones on their own at the end rather than hiding them", () => {
    // A zone in no group is its own group, not an error. Flagging it, or
    // dropping it, would make the ordinary state of a standalone pasture look
    // like something somebody forgot to finish.
    const last = groupedZones(zones).at(-1);

    expect(last?.group).toBeUndefined();
    expect(last?.members.map((z) => z.name)).toEqual(["Tub / chute", "West Pen"]);
  });

  it("keeps an empty group on screen", () => {
    // Made this morning, filled this afternoon. A group that vanishes because
    // it is empty reads as one the app lost.
    const grouped = groupedZones([north, west]);

    expect(grouped[0]?.group?.name).toBe("North");
    expect(grouped[0]?.members).toEqual([]);
  });

  it("says nothing about groups when there are none", () => {
    const grouped = groupedZones([west, tub]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.group).toBeUndefined();
  });

  it("returns an empty list for an empty property", () => {
    expect(groupedZones([])).toEqual([]);
  });
});
