import { describe, expect, it } from "vitest";

import type { FeedingPlan, FeedingPlanLine, Ulid } from "@galaxy-farm/core";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";

import {
  careRecordsFor,
  currentMedicinesFor,
  feedingLinesFor,
  plansFeeding,
} from "../lib/pet-care.js";

/**
 * The joins between a pet and the records that describe it (spec §5.8).
 *
 * These translate between modules that may not import each other, so the
 * failure they exist to prevent is a silent one: a ration or a medicine that
 * simply does not appear on the guide, with nothing anywhere saying why.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const on = (day: number) => new Date(Date.UTC(2026, 5, day, 12));
const NOW = on(15);

const RUSTY = id(1);
const BISCUIT = id(2);
const KIBBLE = id(10);

const feeds = [
  { id: KIBBLE, name: "Purina Pro Plan", category: "pet", unit: "scoop", active: true },
] as unknown as FeedType[];

const health = (overrides: Partial<HealthRecord>): HealthRecord =>
  ({
    id: id(20),
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    animalId: RUSTY,
    type: "vaccination",
    date: on(1),
    ...overrides,
  }) as HealthRecord;

const line = (overrides: Partial<FeedingPlanLine>): FeedingPlanLine => ({
  feedTypeId: KIBBLE,
  amount: { amount: 1, unit: "scoop" },
  frequency: "twice_daily",
  timeOfDay: "morning",
  ...overrides,
});

const plan = (overrides: Partial<FeedingPlan>): FeedingPlan =>
  ({
    id: id(30),
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    name: "Rusty's ration",
    target: "animal",
    targetId: RUSTY,
    alsoFeeds: [],
    portion: "per_head",
    lines: [line({})],
    active: true,
    ...overrides,
  }) as FeedingPlan;

const pets = [
  { id: RUSTY, name: "Rusty" },
  { id: BISCUIT, name: "Biscuit" },
] as { id: Ulid; name: string }[];

describe("careRecordsFor", () => {
  it("labels care by product, so two shots do not satisfy each other's boosters", () => {
    const records = careRecordsFor([
      health({ id: id(20), product: "Rabies", boosterDueOn: on(40) }),
      health({ id: id(21), product: "Bordetella", boosterDueOn: on(50) }),
    ]);

    expect(records.map((record) => record.label)).toEqual(["Rabies", "Bordetella"]);
    expect(records[0]?.nextDueOn).toEqual(on(40));
  });

  it("falls back to the kind when there is no product", () => {
    expect(careRecordsFor([health({ type: "exam" })])[0]?.label).toBe("exam");
  });
});

describe("feedingLinesFor", () => {
  it("takes every line of every live plan for that pet", () => {
    const lines = feedingLinesFor(
      RUSTY,
      [
        plan({ lines: [line({}), line({ timeOfDay: "evening" })] }),
        plan({ id: id(31), targetId: BISCUIT }),
      ],
      feeds,
    );

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("evening");
  });

  it("leaves out a paused plan", () => {
    expect(feedingLinesFor(RUSTY, [plan({ active: false })], feeds)).toEqual([]);
  });

  it("leaves out a plan aimed at a zone, which is not this pet's", () => {
    expect(feedingLinesFor(RUSTY, [plan({ target: "zone", targetId: RUSTY })], feeds)).toEqual([]);
  });
});

describe("currentMedicinesFor", () => {
  it("lists what the pet is on now, most recent first", () => {
    const medicines = currentMedicinesFor(
      RUSTY,
      [
        health({
          id: id(20),
          type: "treatment",
          product: "Apoquel",
          date: on(10),
          boosterDueOn: on(40),
        }),
        health({
          id: id(21),
          type: "deworming",
          product: "Drontal",
          date: on(12),
          boosterDueOn: on(90),
          dose: { amount: 1, unit: "dose" },
        }),
      ],
      NOW,
    );

    expect(medicines).toEqual(["Drontal, 1 dose", "Apoquel"]);
  });

  it("drops a course that has already come round", () => {
    // A dewormer given in March is history. What a helper needs is the tablet
    // that still has to go in the food.
    expect(
      currentMedicinesFor(
        RUSTY,
        [health({ type: "treatment", product: "Apoquel", date: on(1), boosterDueOn: on(5) })],
        NOW,
      ),
    ).toEqual([]);
  });

  it("leaves vaccinations out — a shot is not something a sitter has to give", () => {
    expect(
      currentMedicinesFor(
        RUSTY,
        [health({ type: "vaccination", product: "Rabies", boosterDueOn: on(400) })],
        NOW,
      ),
    ).toEqual([]);
  });

  it("keeps the note, which is where the instruction actually is", () => {
    const medicines = currentMedicinesFor(
      RUSTY,
      [
        health({
          type: "treatment",
          product: "Apoquel",
          boosterDueOn: on(40),
          notes: "one tablet with breakfast",
        }),
      ],
      NOW,
    );

    expect(medicines).toEqual(["Apoquel — one tablet with breakfast"]);
  });

  it("does not put one pet's medicine on another's card", () => {
    expect(
      currentMedicinesFor(
        BISCUIT,
        [health({ type: "treatment", product: "Apoquel", boosterDueOn: on(40) })],
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("a bowl two pets share", () => {
  const bowl = plan({
    id: id(32),
    name: "The barn cats",
    targetId: RUSTY,
    alsoFeeds: [BISCUIT],
    portion: "shared",
  });

  it("shows on both their cards, not just the one it is filed under", () => {
    expect(plansFeeding(RUSTY, [bowl])).toHaveLength(1);
    expect(plansFeeding(BISCUIT, [bowl])).toHaveLength(1);
    expect(plansFeeding(id(9), [bowl])).toEqual([]);
  });

  it("says whose the amount is, so nobody puts it out twice", () => {
    // The same line appears on two cards. Without the names, "1 scoop twice a
    // day" on each is two scoops going into one bowl.
    expect(feedingLinesFor(RUSTY, [bowl], feeds, pets)).toEqual([
      "1 scoop of Purina Pro Plan between Rusty and Biscuit, twice a day, morning",
    ]);
    expect(feedingLinesFor(BISCUIT, [bowl], feeds, pets)).toEqual([
      "1 scoop of Purina Pro Plan between Rusty and Biscuit, twice a day, morning",
    ]);
  });

  it("says nothing about sharing when the amount is each", () => {
    const each = plan({ id: id(33), alsoFeeds: [BISCUIT], portion: "per_head" });

    expect(feedingLinesFor(RUSTY, [each], feeds, pets)[0]).not.toContain("between");
  });

  it("still reads correctly without the names to hand", () => {
    // A screen that has not got the herd should degrade, not refuse.
    expect(feedingLinesFor(RUSTY, [bowl], feeds)[0]).toBe(
      "1 scoop of Purina Pro Plan, twice a day, morning",
    );
  });

  it("reads a plan written before the fields existed", () => {
    const old = { ...plan({}) };
    delete (old as { alsoFeeds?: unknown }).alsoFeeds;
    delete (old as { portion?: unknown }).portion;

    expect(plansFeeding(RUSTY, [old])).toHaveLength(1);
    expect(feedingLinesFor(RUSTY, [old], feeds, pets)[0]).not.toContain("between");
  });
});
