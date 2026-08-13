import { describe, expect, it } from "vitest";

import type { FeedingPlan, FeedingPlanLine, Ulid } from "@galaxy-farm/core";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";

import {
  careRecordsFor,
  currentMedicinesFor,
  describePlanLine,
  feedingLinesFor,
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
    lines: [line({})],
    active: true,
    ...overrides,
  }) as FeedingPlan;

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

describe("describePlanLine", () => {
  it("says the ration the way somebody would say it out loud", () => {
    expect(describePlanLine(line({}), feeds)).toBe(
      "1 scoop of Purina Pro Plan, twice a day, morning",
    );
  });

  it("pluralises the vessel", () => {
    expect(describePlanLine(line({ amount: { amount: 2, unit: "scoop" } }), feeds)).toContain(
      "2 scoops",
    );
  });

  it("keeps the line's own note, which is usually the important half", () => {
    expect(describePlanLine(line({ notes: "in the blue bowl" }), feeds)).toBe(
      "1 scoop of Purina Pro Plan, twice a day, morning — in the blue bowl",
    );
  });

  it("says 'feed' rather than nothing when the catalogue entry is gone", () => {
    // A deleted feed must not make the whole line vanish off the guide.
    expect(describePlanLine(line({}), [])).toContain("of feed");
  });

  it("reads a multi-word unit as words", () => {
    expect(describePlanLine(line({ amount: { amount: 1, unit: "square_bale" } }), feeds)).toContain(
      "1 square bale",
    );
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
