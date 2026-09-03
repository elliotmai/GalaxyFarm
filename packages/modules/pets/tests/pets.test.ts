import { describe, expect, it } from "vitest";

import type { Animal, Ulid } from "@galaxy-farm/core";

import {
  isPet,
  outstandingPetCare,
  penAssignments,
  petBriefing,
  petBriefings,
  petsOnFarm,
  PET_SPECIES,
  type PetCareRecord,
} from "../src/index.js";

/**
 * §5.8, and the one sentence in it that matters most: "Pets appear in the
 * housesitter guide automatically."
 *
 * The tests below are about the two ways that can go wrong — care that is
 * outstanding but not shown, and a dog that bites listed under one that does
 * not.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const on = (day: number) => new Date(Date.UTC(2026, 5, day, 12));
const NOW = on(15);

const animal = (overrides: Partial<Animal> & Pick<Animal, "id">): Animal =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    species: "dog",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
    ...overrides,
  }) as Animal;

describe("what counts as a pet", () => {
  it("is a dog or a cat, and nothing else", () => {
    expect(PET_SPECIES).toEqual(["dog", "cat"]);
    expect(isPet({ species: "cat" })).toBe(true);
    expect(isPet({ species: "cattle" })).toBe(false);
  });

  it("keeps a pet out of the placements a pen is worked out from", () => {
    // Reported: a dog was dragged into a pen on the property map, which the
    // map was perfectly willing to write. The row exists; what has to stop is
    // it counting — as an occupant, as a head against capacity, and as a
    // handling level the pen inherits from whoever is standing in it.
    const rusty = animal({ id: id(1), name: "Rusty" });
    const cow = animal({ id: id(2), name: "Andromeda", species: "cattle" });

    const kept = penAssignments(
      [
        { animalId: rusty.id, zoneId: id(9) },
        { animalId: cow.id, zoneId: id(9) },
      ],
      [rusty, cow],
    );

    expect(kept).toEqual([{ animalId: cow.id, zoneId: id(9) }]);
  });

  it("leaves a placement alone when it cannot see the animal behind it", () => {
    // A device part-way through a sync holds assignments whose animals have
    // not landed yet. Dropping those would empty every pen on the board for as
    // long as the gap lasts, which is a worse lie than the one being fixed.
    const stranger = { animalId: id(7), zoneId: id(9) };

    expect(penAssignments([stranger], [])).toEqual([stranger]);
  });

  it("lists the ones still living here, by name", () => {
    const pets = petsOnFarm([
      animal({ id: id(1), name: "Rusty" }),
      animal({ id: id(2), name: "Biscuit", species: "cat" }),
      // Gone, and a housesitter must not be sent looking for her.
      animal({ id: id(3), name: "Poppy", status: "deceased", diedOn: on(2) }),
      animal({ id: id(4), name: "Andromeda", species: "cattle" }),
    ]);

    expect(pets.map((pet) => pet.name)).toEqual(["Biscuit", "Rusty"]);
  });
});

describe("outstandingPetCare", () => {
  const rabies = (overrides: Partial<PetCareRecord>): PetCareRecord => ({
    id: id(10),
    animalId: id(1),
    label: "Rabies",
    performedOn: on(1),
    nextDueOn: on(20),
    ...overrides,
  });

  it("reports a booster inside the lead time, and how long is left", () => {
    const needs = outstandingPetCare([rabies({})], NOW);

    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ label: "Rabies", status: "upcoming", daysUntil: 5 });
  });

  it("says nothing about one that is still months away", () => {
    expect(outstandingPetCare([rabies({ nextDueOn: on(90) })], NOW)).toEqual([]);
  });

  it("calls a passed date overdue rather than upcoming", () => {
    const needs = outstandingPetCare([rabies({ nextDueOn: on(3) })], NOW);

    expect(needs[0]?.status).toBe("overdue");
    expect(needs[0]?.daysUntil).toBeLessThan(0);
  });

  it("treats a later record of the same thing as having covered it", () => {
    // Giving the booster is itself a record. Asking somebody to also tick the
    // first one off guarantees the two disagree.
    const needs = outstandingPetCare(
      [
        rabies({ id: id(10), nextDueOn: on(10) }),
        rabies({ id: id(11), performedOn: on(11), nextDueOn: on(300) }),
      ],
      NOW,
    );

    expect(needs).toEqual([]);
  });

  it("does not let another pet's shot cover this one", () => {
    const needs = outstandingPetCare(
      [
        rabies({ id: id(10), nextDueOn: on(10) }),
        rabies({ id: id(11), animalId: id(2), performedOn: on(11), nextDueOn: on(300) }),
      ],
      NOW,
    );

    expect(needs.map((need) => need.animalId)).toEqual([id(1)]);
  });

  it("ignores a record with no next date — most treatments have none", () => {
    expect(outstandingPetCare([rabies({ nextDueOn: undefined })], NOW)).toEqual([]);
  });

  it("orders the soonest first, so the list reads as a queue", () => {
    const needs = outstandingPetCare(
      [
        rabies({ id: id(10), label: "Rabies", nextDueOn: on(20) }),
        rabies({ id: id(11), label: "Heartworm", nextDueOn: on(2) }),
        rabies({ id: id(12), label: "Flea", nextDueOn: on(16) }),
      ],
      NOW,
    );

    expect(needs.map((need) => need.label)).toEqual(["Heartworm", "Flea", "Rabies"]);
  });
});

describe("petBriefing", () => {
  it("leads with the handling level in words, not a number", () => {
    const briefing = petBriefing({
      pet: animal({
        id: id(1),
        name: "Rusty",
        safetyLevel: 4,
        safetyNotes: "Guards the porch. Let him out before you come in.",
        customInstructions: "Back door, not the gate.",
      }),
      feeding: [{ text: "1 scoop of Purina, twice daily" }],
      medicines: ["Apoquel, one tablet with breakfast"],
      vetName: "Dr. Reyes",
      vetPhone: "555-0142",
    });

    expect(briefing.safetyLabel).not.toBe("4");
    expect(briefing.safetyLabel.length).toBeGreaterThan(1);
    expect(briefing.handleWithCare).toBe(true);
    expect(briefing.vet).toBe("Dr. Reyes — 555-0142");
    expect(briefing.feeding).toEqual(["1 scoop of Purina, twice daily"]);
    expect(briefing.medicines).toEqual(["Apoquel, one tablet with breakfast"]);
  });

  it("names the vet without a number rather than dropping them", () => {
    const briefing = petBriefing({
      pet: animal({ id: id(1), name: "Rusty" }),
      feeding: [],
      medicines: [],
      vetName: "Dr. Reyes",
    });

    expect(briefing.vet).toBe("Dr. Reyes");
  });

  it("honours the farm's own words for a level", () => {
    const briefing = petBriefing(
      { pet: animal({ id: id(1), name: "Rusty", safetyLevel: 3 }), feeding: [], medicines: [] },
      { 3: "Ask first" },
    );

    expect(briefing.safetyLabel).toBe("Ask first");
  });

  it("puts the animal a helper must be careful with at the top", () => {
    const briefings = petBriefings([
      { pet: animal({ id: id(1), name: "Biscuit", safetyLevel: 1 }), feeding: [], medicines: [] },
      { pet: animal({ id: id(2), name: "Rusty", safetyLevel: 5 }), feeding: [], medicines: [] },
      { pet: animal({ id: id(3), name: "Alfie", safetyLevel: 1 }), feeding: [], medicines: [] },
    ]);

    expect(briefings.map((briefing) => briefing.name)).toEqual(["Rusty", "Alfie", "Biscuit"]);
  });
});
