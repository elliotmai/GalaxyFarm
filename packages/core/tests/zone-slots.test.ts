import { describe, expect, it } from "vitest";

import {
  conflictingAssignments,
  doubleBookedAnimals,
  effectiveSlot,
  moveToZone,
  openAssignments,
  slotForZone,
  type ZoneAssignment,
} from "../src/entities/zone-assignment.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * An animal stands in at most two places: one outside, one inside (§5.1).
 *
 * Not a limitation — it is what is physically true. Without it the pen board
 * lists the same cow in three pastures and stops being worth walking out with,
 * and "where is she" has no answer.
 */

const id = (n: number): Ulid => `01HQ${String(n).padStart(22, "0")}` as Ulid;

const TRAP = id(1);
const NORTH = id(2);
const BARN = id(3);
const STALL = id(4);
const COW = id(9);

/** The barn and the stall are indoor; the traps are not. */
const INDOOR = new Set([BARN, STALL]);

const at = new Date("2026-08-11T08:00:00Z");
const later = new Date("2026-08-11T17:00:00Z");

function assignment(over: Partial<ZoneAssignment> & { zoneId: Ulid }): ZoneAssignment {
  return {
    id: id(50),
    propertyId: id(0),
    createdAt: at,
    updatedAt: at,
    animalId: COW,
    periodFrom: at,
    slot: "outside",
    ...over,
  } as ZoneAssignment;
}

describe("slotForZone", () => {
  it("reads the slot off the zone rather than asking", () => {
    // §2: derive, don't duplicate. The zone already knows it is indoor, and
    // asking somebody to restate it while moving a cow is asking them to be
    // wrong occasionally.
    expect(slotForZone({ indoor: true })).toBe("inside");
    expect(slotForZone({ indoor: false })).toBe("outside");
  });
});

describe("effectiveSlot", () => {
  it("counts a legacy `primary` row against the slot its zone implies", () => {
    // Every assignment was `primary` before slots were used. Trusting the
    // stored string would let a cow with an old row in a trap be moved into a
    // second trap — two different slot values, one cow, two pastures.
    expect(effectiveSlot({ zoneId: TRAP, slot: "primary" }, INDOOR)).toBe("outside");
    expect(effectiveSlot({ zoneId: BARN, slot: "primary" }, INDOOR)).toBe("inside");
  });

  it("falls back to the stored slot for a zone it does not know", () => {
    // A zone deleted out from under an assignment is a different problem, and
    // guessing "outside" would silently close somebody's barn assignment.
    expect(effectiveSlot({ zoneId: id(99), slot: "inside" }, INDOOR)).toBe("inside");
  });
});

describe("moveToZone", () => {
  it("closes the outside pen she was in when she moves to another one", () => {
    const existing = [assignment({ zoneId: TRAP })];

    const { closed, opened } = moveToZone(
      existing,
      {
        id: id(60),
        propertyId: id(0),
        createdAt: later,
        updatedAt: later,
        animalId: COW,
        zoneId: NORTH,
        indoor: false,
        at: later,
      },
      INDOOR,
    );

    expect(closed).toHaveLength(1);
    expect(closed[0]?.zoneId).toBe(TRAP);
    expect(closed[0]?.periodTo).toEqual(later);
    expect(opened.zoneId).toBe(NORTH);
    expect(opened.slot).toBe("outside");
  });

  it("leaves the pasture assignment alone when she goes into the barn", () => {
    // The whole point of two slots: a cow in a stall overnight has not left
    // her trap, and closing it would lose where she goes back to.
    const existing = [assignment({ zoneId: TRAP })];

    const { closed, opened } = moveToZone(
      existing,
      {
        id: id(61),
        propertyId: id(0),
        createdAt: later,
        updatedAt: later,
        animalId: COW,
        zoneId: BARN,
        indoor: true,
        at: later,
      },
      INDOOR,
    );

    expect(closed).toEqual([]);
    expect(opened.slot).toBe("inside");
  });

  it("closes every open assignment in the slot, not just the first", () => {
    // More than one means the rule was already broken — an older build, or a
    // create that synced while its matching close was rejected. This is where
    // it gets repaired, rather than leaving a cow in two pastures forever.
    const existing = [
      assignment({ id: id(51), zoneId: TRAP }),
      assignment({ id: id(52), zoneId: NORTH, slot: "primary" }),
    ];

    const { closed } = moveToZone(
      existing,
      {
        id: id(62),
        propertyId: id(0),
        createdAt: later,
        updatedAt: later,
        animalId: COW,
        zoneId: id(5),
        indoor: false,
        at: later,
      },
      INDOOR,
    );

    expect(closed.map((entry) => entry.zoneId).sort()).toEqual([TRAP, NORTH].sort());
  });

  it("does not close and reopen the pen she is already in", () => {
    // A zero-length period in the history, written because somebody tapped the
    // zone she was already standing in.
    const existing = [assignment({ zoneId: TRAP })];

    const { closed } = moveToZone(
      existing,
      {
        id: id(63),
        propertyId: id(0),
        createdAt: later,
        updatedAt: later,
        animalId: COW,
        zoneId: TRAP,
        indoor: false,
        at: later,
      },
      INDOOR,
    );

    expect(closed).toEqual([]);
  });

  it("ignores another animal's assignments", () => {
    const existing = [assignment({ zoneId: TRAP, animalId: id(80) })];

    const { closed } = moveToZone(
      existing,
      {
        id: id(64),
        propertyId: id(0),
        createdAt: later,
        updatedAt: later,
        animalId: COW,
        zoneId: NORTH,
        indoor: false,
        at: later,
      },
      INDOOR,
    );

    expect(closed).toEqual([]);
  });

  it("ignores assignments that are already closed", () => {
    // History is not something to close again.
    const existing = [assignment({ zoneId: TRAP, periodTo: at })];

    const { closed } = moveToZone(
      existing,
      {
        id: id(65),
        propertyId: id(0),
        createdAt: later,
        updatedAt: later,
        animalId: COW,
        zoneId: NORTH,
        indoor: false,
        at: later,
      },
      INDOOR,
    );

    expect(closed).toEqual([]);
  });
});

describe("openAssignments", () => {
  it("returns where she is standing now and not where she has been", () => {
    const existing = [
      assignment({ id: id(51), zoneId: TRAP, periodTo: at }),
      assignment({ id: id(52), zoneId: NORTH }),
      assignment({ id: id(53), zoneId: BARN, slot: "inside" }),
    ];

    expect(
      openAssignments(existing, COW)
        .map((entry) => entry.zoneId)
        .sort(),
    ).toEqual([NORTH, BARN].sort());
  });
});

describe("conflictingAssignments", () => {
  it("finds only the open ones in the slot being moved into", () => {
    const existing = [
      assignment({ id: id(51), zoneId: NORTH }),
      assignment({ id: id(52), zoneId: BARN, slot: "inside" }),
    ];

    expect(conflictingAssignments(existing, COW, "outside", INDOOR)).toHaveLength(1);
    expect(conflictingAssignments(existing, COW, "inside", INDOOR)).toHaveLength(1);
  });
});

describe("doubleBookedAnimals", () => {
  it("says nothing when every animal is in one pen per slot", () => {
    const existing = [
      assignment({ id: id(51), zoneId: NORTH }),
      assignment({ id: id(52), zoneId: BARN, slot: "inside" }),
    ];

    expect(doubleBookedAnimals(existing, INDOOR)).toEqual([]);
  });

  it("names an animal standing in two outside pens at once", () => {
    // Invisible on any one screen and obvious across all of them, which is
    // exactly why it needs a query rather than an eye.
    const existing = [
      assignment({ id: id(51), zoneId: NORTH }),
      assignment({ id: id(52), zoneId: TRAP, slot: "primary" }),
    ];

    expect(doubleBookedAnimals(existing, INDOOR)).toEqual([COW]);
  });

  it("does not call one inside and one outside a double booking", () => {
    const existing = [
      assignment({ id: id(51), zoneId: NORTH }),
      assignment({ id: id(52), zoneId: STALL, slot: "inside" }),
    ];

    expect(doubleBookedAnimals(existing, INDOOR)).toEqual([]);
  });
});
