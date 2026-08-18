import { describe, expect, it } from "vitest";

import type { Animal, GeoPoint, Ulid, Zone, ZoneAssignment } from "@galaxy-farm/core";

import { animalChips, zoneShapes } from "@/lib/map-shapes";

/**
 * The farm, flattened for the spatial editor (issue #8).
 *
 * Three decisions are worth pinning down here, because each is invisible on
 * screen when it goes wrong: which zone a cow is *drawn* in when she is in
 * two, whose safety level a pen's border carries, and which ground can be
 * dropped on at all.
 */

const NOW = new Date("2026-06-15T12:00:00Z");
const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5G${String(n).padStart(2, "0")}` as Ulid;

const base = { propertyId: PROPERTY, createdAt: NOW, updatedAt: NOW };

const ring: GeoPoint[] = [
  { lat: 32.736, lng: -97.41 },
  { lat: 32.738, lng: -97.406 },
  { lat: 32.734, lng: -97.405 },
];

function zone(over: Partial<Zone> & Pick<Zone, "id" | "name">): Zone {
  return {
    ...base,
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 1,
    waterSourceIds: [],
    resting: false,
    active: true,
    boundary: ring,
    ...over,
  } as Zone;
}

function animal(over: Partial<Animal> & Pick<Animal, "id">): Animal {
  return {
    ...base,
    species: "cattle",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
    ...over,
  } as Animal;
}

function assignment(
  animalId: Ulid,
  zoneId: Ulid,
  over: Partial<ZoneAssignment> = {},
): ZoneAssignment {
  return {
    ...base,
    id: `${animalId}${zoneId}`.slice(0, 26) as Ulid,
    animalId,
    zoneId,
    slot: "outside",
    periodFrom: new Date("2026-01-01T00:00:00Z"),
    ...over,
  } as ZoneAssignment;
}

const TRAP = zone({ id: id(1), name: "North Trap", baselineSafetyLevel: 2 });
const BULL = animal({ id: id(10), name: "Ranger", safetyLevel: 5 });

describe("zoneShapes", () => {
  it("carries the effective safety level, not the zone's own", () => {
    // The derivation §5.1 exists for: the bull moved into a green pen turns it
    // red at the moment he arrives, because nothing cached the old answer.
    const [shape] = zoneShapes([TRAP], [BULL], [assignment(BULL.id, TRAP.id)], NOW);

    expect(shape?.rank).toBe(5);
  });

  it("ignores animals that are no longer on the place", () => {
    // A sold cow with an assignment nobody closed must not hold a pen red.
    const sold = animal({ id: id(11), name: "Gone", safetyLevel: 5, status: "sold" });
    const [shape] = zoneShapes([TRAP], [sold], [assignment(sold.id, TRAP.id)], NOW);

    expect(shape?.rank).toBe(2);
  });

  it("reads the level as of the moment asked for, not whoever was ever there", () => {
    const closed = assignment(BULL.id, TRAP.id, {
      periodTo: new Date("2026-03-01T00:00:00Z"),
    });

    expect(zoneShapes([TRAP], [BULL], [closed], NOW)[0]?.rank).toBe(2);
    expect(zoneShapes([TRAP], [BULL], [closed], new Date("2026-02-01T00:00:00Z"))[0]?.rank).toBe(5);
  });

  it("refuses drops on ground that holds nothing", () => {
    const shapes = zoneShapes(
      [
        zone({ id: id(2), name: "North", type: "area" }),
        zone({ id: id(3), name: "Working pens", type: "working_facility" }),
        TRAP,
      ],
      [],
      [],
      NOW,
    );

    const accepts = Object.fromEntries(shapes.map((shape) => [shape.label, shape.acceptsChips]));
    expect(accepts).toEqual({ North: false, "Working pens": false, "North Trap": true });
  });

  it("draws the groups first, so a pen inside an area wins the drop", () => {
    // The editor takes the last shape containing the point, and a pen inside a
    // pasture is the more specific answer to "where did that land".
    const shapes = zoneShapes(
      [TRAP, zone({ id: id(2), name: "North", type: "area" })],
      [],
      [],
      NOW,
    );

    expect(shapes.map((shape) => shape.label)).toEqual(["North", "North Trap"]);
  });

  it("leaves somewhere that is not this property off the map entirely", () => {
    const away = zone({ id: id(4), name: "Collection facility", type: "off_site" });

    expect(zoneShapes([TRAP, away], [], [], NOW).map((s) => s.label)).toEqual(["North Trap"]);
  });

  it("says when a standing fence means part of a pasture only", () => {
    const split = zone({
      id: id(5),
      name: "Pasture",
      type: "pasture",
      dividers: [
        {
          id: "cross",
          name: "Cross fence",
          line: [ring[0] as GeoPoint, ring[1] as GeoPoint],
          up: true,
          waterSourceIds: [],
          closes: "the creek end",
        },
      ],
    });

    const [shape] = zoneShapes([split], [], [], NOW);
    expect(shape?.sublabel).toContain("shut out of the creek end");
    expect(shape?.lines?.[0]?.dashed).toBe(false);

    // Down again: same fence, drawn dashed, and the name says the whole field.
    const [whole] = zoneShapes(
      [{ ...split, dividers: [{ ...(split.dividers ?? [])[0], up: false }] } as Zone],
      [],
      [],
      NOW,
    );
    expect(whole?.sublabel).toBeUndefined();
    expect(whole?.lines?.[0]?.dashed).toBe(true);
  });

  it("passes resting and retired ground through as the states they are", () => {
    const [resting] = zoneShapes([zone({ id: id(6), name: "South", resting: true })], [], [], NOW);
    const [retired] = zoneShapes(
      [zone({ id: id(7), name: "Old lot", active: false })],
      [],
      [],
      NOW,
    );

    expect(resting?.resting).toBe(true);
    expect(retired?.inactive).toBe(true);
  });
});

describe("animalChips", () => {
  const barn = zone({ id: id(20), name: "Red Barn", type: "barn", indoor: true });

  it("draws a cow on the ground she is on, not in the barn she is also in", () => {
    // A map of ground shows the outside assignment. It is also what makes
    // dragging work: a drop on a pasture closes the *outside* assignment, so a
    // chip that followed her stall would snap back into the barn.
    const cow = animal({ id: id(21), name: "Dolly" });
    const chips = animalChips(
      [TRAP, barn],
      [cow],
      [assignment(cow.id, barn.id, { slot: "inside" }), assignment(cow.id, TRAP.id)],
      NOW,
    );

    expect(chips[0]?.shapeId).toBe(TRAP.id);
  });

  it("draws her in the barn when that is the only place she is", () => {
    const cow = animal({ id: id(22), name: "Belle" });
    const chips = animalChips(
      [TRAP, barn],
      [cow],
      [assignment(cow.id, barn.id, { slot: "inside" })],
      NOW,
    );

    expect(chips[0]?.shapeId).toBe(barn.id);
  });

  it("leaves an unplaced animal without a shape rather than off the screen", () => {
    // The editor collects these into a tray under the map. An animal missing
    // from the map is indistinguishable from an animal missing.
    const chips = animalChips([TRAP], [animal({ id: id(23), name: "Nowhere" })], [], NOW);

    expect(chips[0]?.shapeId).toBeUndefined();
  });

  it("keeps sold and dead animals off it", () => {
    const chips = animalChips(
      [TRAP],
      [animal({ id: id(24), name: "Sold", status: "sold" }), BULL],
      [],
      NOW,
    );

    expect(chips.map((chip) => chip.label)).toEqual(["Ranger"]);
  });

  it("carries her own safety level and her own words", () => {
    const cow = animal({
      id: id(25),
      name: "Dolly",
      tagNumber: "17",
      safetyLevel: 4,
      safetyNotes: "Kicks when cornered.",
      customInstructions: "Hand feed only.",
    });

    const [chip] = animalChips([TRAP], [cow], [], NOW);

    expect(chip?.label).toBe("Dolly (17)");
    expect(chip?.rank).toBe(4);
    expect(chip?.instructions).toBe("Kicks when cornered.\n\nHand feed only.");
  });
});
