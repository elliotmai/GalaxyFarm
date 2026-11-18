import { describe, expect, it } from "vitest";

import { choreDaySheet, type Task } from "../src/entities/task.js";
import {
  FEEDING_TIME_ORDER,
  feedingChoreId,
  feedingOccurrences,
  feedingTripsForDay,
  lineOccursOn,
  type FeedingChoreText,
} from "../src/entities/feeding-chore.js";
import type { FeedingPlan, FeedingPlanLine } from "../src/entities/feeding-plan.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * Feeding as work (spec §2, §5.1, §5.3).
 *
 * The rule under test is §5.1's, borrowed from the water tanks: one chore per
 * trip, never one per line. "Tanks are shared, and one chore per zone would
 * send someone to the same trough more than once" — and a chore list that does
 * that stops being trusted. A pen fed hay and grain in the morning is one walk.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const NORTH = "01ARZ3NDEKTSV4RRFFQ69G5FZ1" as Ulid;
const SOUTH = "01ARZ3NDEKTSV4RRFFQ69G5FZ2" as Ulid;
const ANDROMEDA = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;
const HAY = "01ARZ3NDEKTSV4RRFFQ69G5FF1" as Ulid;
const GRAIN = "01ARZ3NDEKTSV4RRFFQ69G5FF2" as Ulid;

/** A Wednesday. */
const DATE = new Date("2026-09-02T09:00:00");
const NOW = new Date("2026-09-02T09:00:00");

let counter = 0;
function plan(fields: Partial<FeedingPlan> & { lines: readonly FeedingPlanLine[] }): FeedingPlan {
  counter += 1;
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5FP${counter}` as Ulid,
    propertyId: PROPERTY,
    createdAt: DATE,
    updatedAt: DATE,
    name: `Plan ${counter}`,
    species: "cattle",
    animalIds: [],
    flockIds: [],
    placeZoneId: NORTH,
    portion: "each",
    active: true,
    ...fields,
  } as FeedingPlan;
}

const line = (fields: Partial<FeedingPlanLine> = {}): FeedingPlanLine => ({
  feedTypeId: HAY,
  amount: { amount: 40, unit: "lb" },
  frequency: "once_daily",
  timeOfDay: "morning",
  ...fields,
});

const NAMES: FeedingChoreText = {
  zone: (zoneId) => (zoneId === NORTH ? "North Trap" : String(zoneId)),
  line: (entry) =>
    `${entry.amount.amount} ${entry.amount.unit} ${entry.feedTypeId === HAY ? "hay" : "grain"}`,
};

describe("one chore per trip", () => {
  it("merges every line landing on the same place at the same time", () => {
    const trips = feedingTripsForDay(
      [plan({ lines: [line(), line({ feedTypeId: GRAIN, amount: { amount: 12, unit: "lb" } })] })],
      DATE,
    );

    expect(trips).toHaveLength(1);
    expect(trips[0]?.lines).toHaveLength(2);
  });

  it("merges across separate plans feeding the same pen", () => {
    // Two plans, one pen, one morning. Somebody walks there once.
    const trips = feedingTripsForDay(
      [plan({ lines: [line()] }), plan({ lines: [line({ feedTypeId: GRAIN })] })],
      DATE,
    );

    expect(trips).toHaveLength(1);
    expect(trips[0]?.lines).toHaveLength(2);
  });

  it("splits by time of day, because that is a second walk", () => {
    const trips = feedingTripsForDay(
      [plan({ lines: [line(), line({ timeOfDay: "evening" })] })],
      DATE,
    );

    expect(trips.map((trip) => trip.timeOfDay)).toEqual(["morning", "evening"]);
  });

  it("splits by place, because that is a different pen", () => {
    const trips = feedingTripsForDay(
      [plan({ lines: [line()] }), plan({ placeZoneId: SOUTH, lines: [line()] })],
      DATE,
    );

    expect(trips).toHaveLength(2);
  });

  it("orders the day the way it is worked, not alphabetically", () => {
    const trips = feedingTripsForDay(
      [
        plan({ lines: [line({ timeOfDay: "night" })] }),
        plan({ lines: [line({ timeOfDay: "morning" })] }),
        plan({ lines: [line({ timeOfDay: "evening" })] }),
      ],
      DATE,
    );

    expect(trips.map((trip) => trip.timeOfDay)).toEqual(["morning", "evening", "night"]);
    expect(FEEDING_TIME_ORDER.morning).toBeLessThan(FEEDING_TIME_ORDER.night);
  });

  it("ignores a plan switched off out of season", () => {
    expect(feedingTripsForDay([plan({ active: false, lines: [line()] })], DATE)).toEqual([]);
  });
});

describe("which days a line lands on", () => {
  const anchor = new Date("2026-09-02T00:00:00");

  it("puts the daily frequencies out every day", () => {
    for (const frequency of ["once_daily", "twice_daily", "three_times_daily"] as const) {
      expect(lineOccursOn(frequency, anchor, new Date("2026-09-05T00:00:00")), frequency).toBe(
        true,
      );
    }
  });

  it("counts every other day from the day the plan was written", () => {
    expect(lineOccursOn("every_other_day", anchor, new Date("2026-09-02T00:00:00"))).toBe(true);
    expect(lineOccursOn("every_other_day", anchor, new Date("2026-09-03T00:00:00"))).toBe(false);
    expect(lineOccursOn("every_other_day", anchor, new Date("2026-09-04T00:00:00"))).toBe(true);
  });

  it("puts a twice-weekly line out on the plan's weekday and half a week on", () => {
    // Wednesday and Saturday.
    expect(lineOccursOn("twice_weekly", anchor, new Date("2026-09-05T00:00:00"))).toBe(true);
    expect(lineOccursOn("twice_weekly", anchor, new Date("2026-09-09T00:00:00"))).toBe(true);
    expect(lineOccursOn("twice_weekly", anchor, new Date("2026-09-06T00:00:00"))).toBe(false);
  });

  it("puts a weekly line out on the weekday the plan was written", () => {
    // The anchor is a Wednesday, and a feeding line carries no day-of-week.
    expect(lineOccursOn("weekly", anchor, new Date("2026-09-09T00:00:00"))).toBe(true);
    expect(lineOccursOn("weekly", anchor, new Date("2026-09-10T00:00:00"))).toBe(false);
  });
});

describe("the entry it becomes", () => {
  it("says when and which ration in the title, and what to carry in the detail", () => {
    const [entry] = feedingOccurrences(
      [
        plan({
          name: "Herd ration",
          lines: [line(), line({ feedTypeId: GRAIN, amount: { amount: 12, unit: "lb" } })],
        }),
      ],
      NAMES,
      DATE,
      NOW,
    );

    // Named for the plan, not the pen: the pen is the row's zone.
    expect(entry?.title).toBe("Morning feed · Herd ration");
    expect(entry?.zoneId).toBe(NORTH);
    expect(entry?.detail).toBe("40 lb hay · 12 lb grain");
  });

  it("carries the zone, so the sheet can group by pen", () => {
    const [entry] = feedingOccurrences([plan({ lines: [line()] })], NAMES, DATE, NOW);

    expect(entry?.zoneId).toBe(NORTH);
    expect(entry?.animalId).toBeUndefined();
  });

  it("titles a trip with no place by its plan, never by one animal's name", () => {
    // A plan can feed several animals, so a title carrying one animal's name
    // would read as feeding only that one. The plan's name covers everybody.
    const [entry] = feedingOccurrences(
      [
        plan({
          placeZoneId: undefined,
          animalIds: [ANDROMEDA],
          name: "Show calf mix",
          lines: [line()],
        }),
      ],
      NAMES,
      DATE,
      NOW,
    );

    expect(entry?.title).toBe("Morning feed · Show calf mix");
  });

  it("keeps two plans with no place as two trips, each titled by its plan", () => {
    const entries = feedingOccurrences(
      [
        plan({
          placeZoneId: undefined,
          animalIds: [ANDROMEDA],
          name: "Show calf mix",
          // Two lines of one plan are one trip.
          lines: [line(), line({ feedTypeId: GRAIN, amount: { amount: 12, unit: "lb" } })],
        }),
        plan({
          placeZoneId: undefined,
          animalIds: [ANDROMEDA],
          name: "Joint supplement",
          lines: [line()],
        }),
      ],
      NAMES,
      DATE,
      NOW,
    );

    expect(entries.map((entry) => entry.title).sort()).toEqual([
      "Morning feed · Joint supplement",
      "Morning feed · Show calf mix",
    ]);
  });

  it("merges plans fed in the same room into one stop, whatever the case of its name", () => {
    // The dog and both cats are fed in the kitchen at night: one trip.
    const trips = feedingTripsForDay(
      [
        plan({
          placeZoneId: undefined,
          placeLabel: "Kitchen",
          species: "dog",
          lines: [line({ timeOfDay: "night" })],
        }),
        plan({
          placeZoneId: undefined,
          placeLabel: "kitchen ",
          species: "cat",
          lines: [line({ timeOfDay: "night" })],
        }),
      ],
      DATE,
    );

    expect(trips).toHaveLength(1);
    expect(trips[0]?.place).toEqual({ kind: "place", label: "Kitchen" });
  });

  it("carries the animal instead, on a plan for one animal with no place", () => {
    const [entry] = feedingOccurrences(
      [plan({ placeZoneId: undefined, animalIds: [ANDROMEDA], lines: [line()] })],
      NAMES,
      DATE,
      NOW,
    );

    expect(entry?.animalId).toBe(ANDROMEDA);
    expect(entry?.zoneId).toBeUndefined();
  });

  it("is late once its part of the day has passed, not at midnight", () => {
    // A template says which day and nothing finer, so its instance is due at
    // the end of it. A feeding line says which part of the day, and an animal
    // unfed at noon is a thing to know about at noon.
    const noon = new Date("2026-09-02T12:00:00");
    const [morning] = feedingOccurrences([plan({ lines: [line()] })], NAMES, DATE, noon);
    const [evening] = feedingOccurrences(
      [plan({ lines: [line({ timeOfDay: "evening" })] })],
      NAMES,
      DATE,
      noon,
    );

    expect(morning?.overdue).toBe(true);
    expect(evening?.overdue).toBe(false);
  });

  it("keeps its id when a second feed is added to the same trip", () => {
    // The id is what a ticked row points at. Deriving it from the plans behind
    // the trip would orphan that row the moment a ration changed.
    const one = feedingOccurrences([plan({ lines: [line()] })], NAMES, DATE, NOW);
    const two = feedingOccurrences(
      [plan({ lines: [line(), line({ feedTypeId: GRAIN })] })],
      NAMES,
      DATE,
      NOW,
    );

    expect(one[0]?.id).toBe(two[0]?.id);
  });

  it("gives a different id to the same trip on another day", () => {
    const wednesday = feedingOccurrences([plan({ lines: [line()] })], NAMES, DATE, NOW);
    const thursday = feedingOccurrences(
      [plan({ lines: [line()] })],
      NAMES,
      new Date("2026-09-03T09:00:00"),
      NOW,
    );

    expect(wednesday[0]?.id).not.toBe(thursday[0]?.id);
  });

  it("builds its id from the place rather than the plan", () => {
    expect(
      feedingChoreId({ place: { kind: "zone", zoneId: NORTH }, timeOfDay: "morning" }, DATE),
    ).toBe(`feeding:zone:${NORTH}:morning:2026-09-02`);
    expect(
      feedingChoreId({ place: { kind: "place", label: "Back Porch" }, timeOfDay: "evening" }, DATE),
    ).toBe("feeding:place:back-porch:evening:2026-09-02");
  });
});

describe("merging into the day sheet", () => {
  const task = (fields: Partial<Task>): Task =>
    ({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FT1" as Ulid,
      propertyId: PROPERTY,
      createdAt: DATE,
      updatedAt: DATE,
      title: "Morning feed · Herd ration",
      dueAt: new Date("2026-09-02T11:00:59.999"),
      ...fields,
    }) as Task;

  it("shows a feeding chore beside the written-down ones", () => {
    const derived = feedingOccurrences(
      [plan({ name: "Herd ration", lines: [line()] })],
      NAMES,
      DATE,
      NOW,
    );
    const sheet = choreDaySheet({ tasks: [], templates: [], derived }, DATE, NOW);

    expect(sheet.map((entry) => entry.title)).toContain("Morning feed · Herd ration");
  });

  it("drops the occurrence once somebody has ticked it", () => {
    // The bug this prevents: the tick and the untouched occurrence side by
    // side, which reads as the chore coming straight back.
    const derived = feedingOccurrences([plan({ lines: [line()] })], NAMES, DATE, NOW);
    const ticked = task({
      sourceKey: derived[0]?.id,
      completedAt: new Date("2026-09-02T06:30:00"),
    });

    const sheet = choreDaySheet({ tasks: [ticked], templates: [], derived }, DATE, NOW);
    const feeding = sheet.filter((entry) => entry.title.startsWith("Morning feed"));

    expect(feeding).toHaveLength(1);
    expect(feeding[0]?.completedAt).toBeDefined();
  });

  it("leaves a row alone whose key belongs to another day", () => {
    const derived = feedingOccurrences([plan({ lines: [line()] })], NAMES, DATE, NOW);
    const yesterday = task({ sourceKey: "feeding:zone:x:morning:2026-09-01" });

    const sheet = choreDaySheet({ tasks: [yesterday], templates: [], derived }, DATE, NOW);

    expect(sheet.filter((entry) => entry.title.startsWith("Morning feed"))).toHaveLength(2);
  });

  it("still works for callers that pass no derived entries at all", () => {
    expect(choreDaySheet({ tasks: [], templates: [] }, DATE, NOW)).toEqual([]);
  });
});
