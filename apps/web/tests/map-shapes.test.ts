import { describe, expect, it } from "vitest";

import type { Animal, GeoPoint, Ulid, Zone, ZoneAssignment } from "@galaxy-farm/core";

import { animalChips, zoneShapes } from "@/lib/map-shapes";

/**
 * The farm, flattened for the spatial editor (issues #8, #19).
 *
 * Four decisions are worth pinning down here, because each is invisible on
 * screen when it goes wrong: which zone a cow is *drawn* in when she is in
 * two, whose safety level a pen's border carries, which ground can be dropped
 * on at all, and which instructions a helper is shown when they tap her.
 *
 * The last is the one to test hardest. §5.1's effective instructions are her
 * own plus every pen she is in plus the groups above them, and a merge that
 * drops a level is indistinguishable on screen from a level with nothing in
 * it — the person reading is in a barn with no way to ask.
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

  it("does not let a pet dragged into a pen colour the pen", () => {
    // The slip this is written for: a dog was dragged onto a pen on the map,
    // and the row that wrote is still there. A pen is not somewhere a pet is
    // (§5.8), so it must not inherit his handling level — a green trap gone
    // red because the house dog bites strangers is a pen nobody trusts again.
    const dog = animal({ id: id(12), name: "Rusty", species: "dog", safetyLevel: 5 });
    const [shape] = zoneShapes([TRAP], [dog], [assignment(dog.id, TRAP.id)], NOW);

    expect(shape?.rank).toBe(2);
    expect(shape?.instructions).toEqual([]);
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

  it("keeps the dogs and the cats off it altogether", () => {
    // Reported: a pet was dragged into a pen it has no business in. It was
    // draggable because it was drawn — a pet has no pen (§5.8), so its chip
    // sat in the tray of animals not on the map, in among the stock, one
    // gesture from the North Trap. The fix is that there is no chip.
    const chips = animalChips(
      [TRAP],
      [
        animal({ id: id(26), name: "Rusty", species: "dog" }),
        animal({ id: id(27), name: "Biscuit", species: "cat" }),
        BULL,
      ],
      [],
      NOW,
    );

    expect(chips.map((chip) => chip.label)).toEqual(["Ranger"]);
  });

  it("keeps a pet off it even while a stray placement still names one", () => {
    // The row a mis-drag already wrote. Nothing is deleted — the history is
    // append-only — so what has to be true is that it draws nothing.
    const dog = animal({ id: id(28), name: "Rusty", species: "dog" });
    const chips = animalChips([TRAP], [dog], [assignment(dog.id, TRAP.id)], NOW);

    expect(chips).toEqual([]);
  });

  it("carries her own safety level, and why she is that level", () => {
    // The reason sits beside the level rather than in among the instructions:
    // "kicks when cornered" is a warning, not a chore, and a warning read
    // fourth is a warning read too late.
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
    expect(chip?.rankNote).toBe("Kicks when cornered.");
    expect(chip?.instructions).toEqual([{ from: "Dolly (17)", text: "Hand feed only." }]);
  });
});

/**
 * §5.1: "any animal's effective instructions = its own instructions + its
 * current zone's instructions + any group instructions, displayed merged".
 *
 * The reason #19 asks for this at all is that a helper reading a pen needs one
 * answer rather than three panels to reconcile. Every case below is a way of
 * ending up with two.
 */
describe("merged care instructions", () => {
  const NORTH = zone({ id: id(30), name: "North", type: "area" });
  const PEN = zone({
    id: id(31),
    name: "Pen B",
    parentZoneId: NORTH.id,
    customInstructions: "Latch sticks. Lift, then pull.",
  });
  const STALL = zone({
    id: id(32),
    name: "Stall 3",
    type: "stall",
    indoor: true,
    parentZoneId: NORTH.id,
    customInstructions: "Fan on above 85.",
  });

  const lines = (chip: { instructions?: readonly { from: string; text: string }[] } | undefined) =>
    (chip?.instructions ?? []).map((line) => `${line.from}: ${line.text}`);

  const ANDROMEDA = animal({
    id: id(33),
    name: "Andromeda",
    customInstructions: "No grain — she founders.",
  });

  it("merges her own, her pen's, and the group the pen sits in, in that order", () => {
    // Most specific first, because her own note is the exception — and an
    // exception under three paragraphs of pen routine is one nobody reads.
    const north = { ...NORTH, customInstructions: "Road gate stays chained." } as Zone;
    const [chip] = animalChips([north, PEN], [ANDROMEDA], [assignment(ANDROMEDA.id, PEN.id)], NOW);

    expect(lines(chip)).toEqual([
      "Andromeda: No grain — she founders.",
      "Pen B: Latch sticks. Lift, then pull.",
      "North: Road gate stays chained.",
    ]);
  });

  it("reads both pens for a calf held inside and outside at once", () => {
    // She is drawn on the ground she is on; she is read as being under both
    // sets of rules, because she is. Half of them is worse than none.
    const [chip] = animalChips(
      [NORTH, PEN, STALL],
      [ANDROMEDA],
      [assignment(ANDROMEDA.id, STALL.id, { slot: "inside" }), assignment(ANDROMEDA.id, PEN.id)],
      NOW,
    );

    expect(chip?.shapeId).toBe(PEN.id);
    expect(lines(chip)).toEqual([
      "Andromeda: No grain — she founders.",
      "Pen B: Latch sticks. Lift, then pull.",
      "Stall 3: Fan on above 85.",
    ]);
  });

  it("states a group once when both her pens sit in it", () => {
    const north = { ...NORTH, customInstructions: "Road gate stays chained." } as Zone;
    const [chip] = animalChips(
      [north, PEN, STALL],
      [ANDROMEDA],
      [assignment(ANDROMEDA.id, STALL.id, { slot: "inside" }), assignment(ANDROMEDA.id, PEN.id)],
      NOW,
    );

    expect(lines(chip).filter((line) => line.startsWith("North:"))).toHaveLength(1);
  });

  it("walks the whole way up — a stall is in a barn, and the barn is in an area", () => {
    const north = { ...NORTH, customInstructions: "Road gate stays chained." } as Zone;
    const barn = zone({
      id: id(34),
      name: "Red Barn",
      type: "barn",
      indoor: true,
      parentZoneId: north.id,
      customInstructions: "Lights off at the door.",
    });
    const stall = { ...STALL, parentZoneId: barn.id } as Zone;

    const [chip] = animalChips(
      [north, barn, stall],
      [ANDROMEDA],
      [assignment(ANDROMEDA.id, stall.id, { slot: "inside" })],
      NOW,
    );

    expect(lines(chip)).toEqual([
      "Andromeda: No grain — she founders.",
      "Stall 3: Fan on above 85.",
      "Red Barn: Lights off at the door.",
      "North: Road gate stays chained.",
    ]);
  });

  it("says nothing at all when no level has anything to say", () => {
    // An empty list, not an empty line: the editor says "no instructions
    // recorded" rather than drawing a blank row somebody reads as missing.
    const quiet = animal({ id: id(35), name: "Quiet" });
    const [chip] = animalChips([NORTH, PEN], [quiet], [assignment(quiet.id, PEN.id)], NOW);

    expect(lines(chip)).toEqual(["Pen B: Latch sticks. Lift, then pull."]);

    const bare = zone({ id: id(36), name: "West Pen" });
    const [alone] = animalChips([bare], [quiet], [assignment(quiet.id, bare.id)], NOW);
    expect(alone?.instructions).toEqual([]);
  });

  it("keeps a blank instruction out rather than rendering it as an empty line", () => {
    const blank = animal({ id: id(37), name: "Blank", customInstructions: "   " });
    const [chip] = animalChips(
      [zone({ id: id(38), name: "Pen 1", customInstructions: "" })],
      [blank],
      [],
      NOW,
    );

    expect(chip?.instructions).toEqual([]);
  });

  it("gives a pen its own, its group's, and each animal standing in it", () => {
    // Walking into a pen rather than up to one animal — the same three levels,
    // read the other way round, which is what the housesitter guide composes.
    const north = { ...NORTH, customInstructions: "Road gate stays chained." } as Zone;
    const shapes = zoneShapes([north, PEN], [ANDROMEDA], [assignment(ANDROMEDA.id, PEN.id)], NOW);

    const pen = shapes.find((shape) => shape.label === "Pen B");
    expect(lines(pen)).toEqual([
      "Pen B: Latch sticks. Lift, then pull.",
      "North: Road gate stays chained.",
      "Andromeda: No grain — she founders.",
    ]);
  });
});

/**
 * The halter (spec §5.7, §8).
 *
 * "Every calf in the program has one, rendered as a colour swatch on the Pen
 * Board chip … so anyone in the barn can match calf to halter at a glance."
 * The name travels with the colour everywhere the colour goes: navy and black
 * are the same swatch in a dark barn.
 */
describe("halter colours", () => {
  const CALF = animal({ id: id(40), name: "Comet" });

  it("puts the halter on the chip, named as well as coloured", () => {
    const [chip] = animalChips([TRAP], [CALF], [], NOW, [
      { animalId: CALF.id, halterColor: "#C62828", active: true },
    ]);

    expect(chip?.accent).toBe("#C62828");
    expect(chip?.accentLabel).toBe("Red");
  });

  it("names a colour no show string stocks by what it is, rather than not at all", () => {
    const [chip] = animalChips([TRAP], [CALF], [], NOW, [
      { animalId: CALF.id, halterColor: "#7F5A2E", active: true },
    ]);

    expect(chip?.accentLabel).toBe("#7F5A2E");
  });

  it("leaves an unenrolled calf's chip plain rather than defaulting it to black", () => {
    // Black is what an *enrolled* calf wears when nobody chose (§12 decision
    // 15). A swatch on a calf that is not in the program would say she is.
    const [chip] = animalChips([TRAP], [CALF], [], NOW, []);

    expect(chip?.accent).toBeUndefined();
    expect(chip?.accentLabel).toBeUndefined();
  });

  it("drops the swatch when the enrollment has ended", () => {
    const [chip] = animalChips([TRAP], [CALF], [], NOW, [
      { animalId: CALF.id, halterColor: "#C62828", active: false },
    ]);

    expect(chip?.accent).toBeUndefined();
  });
});
