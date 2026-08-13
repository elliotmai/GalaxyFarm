import { describe, expect, it } from "vitest";

import { composeGuide } from "@galaxy-farm/module-housesitting";
import type { Animal, ChoreTemplate, Contact, Ulid, Zone, ZoneAssignment } from "@galaxy-farm/core";

import {
  guideChores,
  guideEmergencyContacts,
  guideVets,
  guideZonesFrom,
} from "../lib/guide-composition.js";

/**
 * What the housesitter guide is built from (spec §5.10).
 *
 * Every test here is about a way the guide could be quietly wrong rather than
 * visibly broken — an animal listed in the pen it left, a chore printed that
 * the app will never raise, a phone number that is not there. The person
 * reading this document has no way to ask a follow-up question.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const on = (day: number) => new Date(Date.UTC(2026, 5, day, 12));
const NOW = on(15);

const zone = (overrides: Partial<Zone> & Pick<Zone, "id" | "name">): Zone =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 1,
    waterSourceIds: [],
    resting: false,
    active: true,
    ...overrides,
  }) as Zone;

const animal = (overrides: Partial<Animal> & Pick<Animal, "id">): Animal =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    species: "cattle",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
    ...overrides,
  }) as Animal;

const assignment = (
  overrides: Partial<ZoneAssignment> & Pick<ZoneAssignment, "id" | "animalId" | "zoneId">,
): ZoneAssignment =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    periodFrom: on(1),
    slot: "pasture",
    ...overrides,
  }) as ZoneAssignment;

const contact = (overrides: Partial<Contact> & Pick<Contact, "id" | "name">): Contact =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    tags: [],
    phones: [],
    emails: [],
    ...overrides,
  }) as Contact;

const template = (
  overrides: Partial<ChoreTemplate> & Pick<ChoreTemplate, "id" | "title">,
): ChoreTemplate =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    recurrence: "daily",
    recurrenceDays: [],
    active: true,
    ...overrides,
  }) as ChoreTemplate;

describe("guideZonesFrom", () => {
  const NORTH = id(1);
  const BARN = id(2);
  const DOLLY = id(10);

  it("puts an animal in the pen it is in today", () => {
    const zones = guideZonesFrom(
      [zone({ id: NORTH, name: "North Trap" })],
      [assignment({ id: id(20), animalId: DOLLY, zoneId: NORTH })],
      [animal({ id: DOLLY, name: "Dolly", safetyLevel: 4, safetyNotes: "Calf at side" })],
      NOW,
    );

    expect(zones).toHaveLength(1);
    expect(zones[0]?.occupants.map((occupant) => occupant.name)).toEqual(["Dolly"]);
  });

  it("does not list her in the pen she left", () => {
    // The assignment that closed is still on file, because where she was in
    // March is worth keeping. It is not where she is.
    const zones = guideZonesFrom(
      [zone({ id: NORTH, name: "North Trap" }), zone({ id: BARN, name: "Barn" })],
      [
        assignment({ id: id(20), animalId: DOLLY, zoneId: NORTH, periodTo: on(10) }),
        assignment({ id: id(21), animalId: DOLLY, zoneId: BARN, periodFrom: on(10) }),
      ],
      [animal({ id: DOLLY, name: "Dolly" })],
      NOW,
    );

    expect(zones.map((held) => held.name)).toEqual(["Barn"]);
  });

  it("leaves out an empty pen with nothing written on it", () => {
    // A heading with nothing under it is what makes a guide stop being read to
    // the bottom.
    expect(guideZonesFrom([zone({ id: NORTH, name: "North Trap" })], [], [], NOW)).toEqual([]);
  });

  it("keeps an empty pen that has instructions of its own", () => {
    const zones = guideZonesFrom(
      [zone({ id: NORTH, name: "North Trap", customInstructions: "Gate chain, not the latch." })],
      [],
      [],
      NOW,
    );

    expect(zones).toHaveLength(1);
  });

  it("leaves out a zone that has been switched off", () => {
    expect(
      guideZonesFrom(
        [zone({ id: NORTH, name: "North Trap", active: false, customInstructions: "x" })],
        [],
        [],
        NOW,
      ),
    ).toEqual([]);
  });

  it("leaves out an animal that has been sold, even with an assignment still open", () => {
    const zones = guideZonesFrom(
      [zone({ id: NORTH, name: "North Trap", customInstructions: "x" })],
      [assignment({ id: id(20), animalId: DOLLY, zoneId: NORTH })],
      [animal({ id: DOLLY, name: "Dolly", status: "sold" })],
      NOW,
    );

    expect(zones[0]?.occupants).toEqual([]);
  });

  it("hands composeGuide enough to lead each pen with its effective level", () => {
    // The join and the composition meeting is the thing worth asserting: a
    // green pen with the bull in it has to read red.
    const composed = composeGuide(
      { title: "While we are away" },
      guideZonesFrom(
        [zone({ id: NORTH, name: "North Trap", baselineSafetyLevel: 1 })],
        [assignment({ id: id(20), animalId: DOLLY, zoneId: NORTH })],
        [animal({ id: DOLLY, name: "Chief", safetyLevel: 5, safetyNotes: "Bull. Do not enter." })],
        NOW,
      ),
      [],
      NOW,
    );

    expect(composed.pens[0]?.effectiveLevel).toBe(5);
    expect(composed.pens[0]?.doNotHandle).toEqual(["Chief — Bull. Do not enter."]);
  });
});

describe("guideChores", () => {
  it("says the rule rather than a day's instances", () => {
    const chores = guideChores(
      [template({ id: id(30), title: "Feed the chickens" })],
      [zone({ id: id(1), name: "Coop" })],
    );

    expect(chores[0]).toMatchObject({ title: "Feed the chickens", when: "Every day" });
  });

  it("names the zone a chore belongs to, so somebody knows where to go", () => {
    const chores = guideChores(
      [template({ id: id(30), title: "Break the ice", zoneId: id(1) })],
      [zone({ id: id(1), name: "North Trap" })],
    );

    expect(chores[0]?.zoneName).toBe("North Trap");
  });

  it("leaves out a one-off, which the app itself never raises", () => {
    // Printing a chore nothing will generate sends somebody out to do
    // something on a day nobody expected it.
    expect(
      guideChores([template({ id: id(30), title: "Fix the gate", recurrence: "once" })], []),
    ).toEqual([]);
  });

  it("leaves out a template that has been switched off", () => {
    expect(
      guideChores([template({ id: id(30), title: "Old routine", active: false })], []),
    ).toEqual([]);
  });

  it("says out loud when a weekly rule fires on no day at all", () => {
    const chores = guideChores(
      [template({ id: id(30), title: "Muck out", recurrence: "weekly", recurrenceDays: [] })],
      [],
    );

    expect(chores[0]?.when).toContain("never fires");
  });
});

describe("the numbers to ring", () => {
  it("takes the emergency-tagged subset, so nothing is retyped", () => {
    const list = guideEmergencyContacts([
      contact({
        id: id(40),
        name: "Dr. Reyes",
        tags: ["vet", "emergency"],
        phones: [{ label: "Cell", number: "555-0142" }],
      }),
      contact({ id: id(41), name: "Feed store", tags: ["feed_vendor"] }),
    ]);

    expect(list.map((held) => held.name)).toEqual(["Dr. Reyes"]);
    expect(list[0]?.phone).toBe("555-0142");
  });

  it("puts the ones with a number first and still lists the ones without", () => {
    // Dropping them would make the omission invisible, which is the one thing
    // an emergency list must not do.
    const list = guideEmergencyContacts([
      contact({ id: id(40), name: "No number", tags: ["emergency"] }),
      contact({
        id: id(41),
        name: "Has one",
        tags: ["emergency"],
        phones: [{ label: "Cell", number: "555-0100" }],
      }),
    ]);

    expect(list.map((held) => held.name)).toEqual(["Has one", "No number"]);
  });

  it("lists the vet separately, tagged or not for emergencies", () => {
    const vets = guideVets([
      contact({ id: id(40), name: "Dr. Reyes", tags: ["vet"] }),
      contact({ id: id(41), name: "Hauler", tags: ["hauler"] }),
    ]);

    expect(vets.map((held) => held.name)).toEqual(["Dr. Reyes"]);
  });
});
