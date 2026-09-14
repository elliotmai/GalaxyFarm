import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import {
  awayWindow,
  currentTrip,
  legsInOrder,
  tripDatesAreOrdered,
  tripSchema,
  type Trip,
  type TripLeg,
} from "../src/domain/trip.js";

/**
 * When the owners are away (spec §5.10).
 *
 * The board leads with one sentence — "back Sunday" — and every one of these
 * tests is about that sentence being right. A sitter reads it once, on arrival,
 * and plans a week around it; there is no second screen that corrects it.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date(2026, 8, 1),
    updatedAt: new Date(2026, 8, 1),
    name: "Orlando and Cincinnati",
    startDate: new Date(2026, 8, 15),
    endDate: new Date(2026, 8, 20),
    whoIsAway: "Elliot and Mai",
    legs: [],
    source: "manual",
    ...overrides,
  };
}

function leg(overrides: Partial<TripLeg> = {}): TripLeg {
  return {
    transport: "flight",
    from: "DFW",
    to: "MCO",
    departAt: "2026-09-15T09:21",
    departTz: "America/Chicago",
    ...overrides,
  };
}

describe("the away window", () => {
  it("counts the days left while they are away", () => {
    const window = awayWindow(trip(), new Date(2026, 8, 17, 14, 30));

    expect(window.status).toBe("away");
    expect(window.daysUntilReturn).toBe(3);
  });

  it("is measured midnight to midnight, not in elapsed hours", () => {
    // The reason `wholeDaysBetween` truncates to the day: leaving at 9am and
    // asking at 11pm the night before the return is 26 hours, which rounds to
    // "back in 1 day" either way — but asking at 1am on the return day is 8
    // hours, and an hours-based answer would say "back today" on one screen
    // and "back tomorrow" on another depending on the minute it was read.
    const early = awayWindow(trip(), new Date(2026, 8, 20, 0, 30));
    const late = awayWindow(trip(), new Date(2026, 8, 20, 23, 30));

    expect(early.daysUntilReturn).toBe(0);
    expect(late.daysUntilReturn).toBe(0);
    expect(early.status).toBe("away");
    expect(late.status).toBe("away");
  });

  it("stays away for the whole of the return day", () => {
    // A flight landing at 9pm means the sitter is still doing the evening
    // round. Flipping to "over" at midnight on the return date would take the
    // board down while somebody is still standing at it.
    expect(awayWindow(trip(), new Date(2026, 8, 20, 21, 0)).status).toBe("away");
    expect(awayWindow(trip(), new Date(2026, 8, 21, 0, 1)).status).toBe("over");
  });

  it("counts down to a trip that has not started", () => {
    const window = awayWindow(trip(), new Date(2026, 8, 12));

    expect(window.status).toBe("upcoming");
    expect(window.daysUntilDeparture).toBe(3);
  });

  it("is away on the departure day itself", () => {
    expect(awayWindow(trip(), new Date(2026, 8, 15, 6, 0)).status).toBe("away");
  });
});

describe("which trip the board is about", () => {
  it("picks whoever is away right now over one that is merely sooner to start", () => {
    const nowAway = trip({ id: "01ARZ3NDEKTSV4RRFFQ69G5FPA" as Ulid });
    const nextMonth = trip({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FPB" as Ulid,
      startDate: new Date(2026, 9, 2),
      endDate: new Date(2026, 9, 9),
    });

    expect(currentTrip([nextMonth, nowAway], new Date(2026, 8, 17))?.id).toBe(nowAway.id);
  });

  it("falls forward to the next departure once a trip is over", () => {
    const past = trip({ id: "01ARZ3NDEKTSV4RRFFQ69G5FPC" as Ulid });
    const upcoming = trip({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FPD" as Ulid,
      startDate: new Date(2026, 9, 2),
      endDate: new Date(2026, 9, 9),
    });

    expect(currentTrip([past, upcoming], new Date(2026, 8, 25))?.id).toBe(upcoming.id);
  });

  it("ignores a deleted trip", () => {
    // Tombstones travel to kiosks (§4.5 clause 4), so a board that read them
    // would announce a cancelled trip until the device happened to compact.
    const deleted = trip({ deletedAt: new Date(2026, 8, 10) });

    expect(currentTrip([deleted], new Date(2026, 8, 17))).toBeUndefined();
  });

  it("has nothing to say when nobody is going anywhere", () => {
    expect(currentTrip([], new Date(2026, 8, 17))).toBeUndefined();
  });

  it("picks the soonest to return when two overlap", () => {
    const endsFirst = trip({ id: "01ARZ3NDEKTSV4RRFFQ69G5FPE" as Ulid });
    const endsLater = trip({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FPF" as Ulid,
      endDate: new Date(2026, 8, 28),
    });

    expect(currentTrip([endsLater, endsFirst], new Date(2026, 8, 17))?.id).toBe(endsFirst.id);
  });
});

describe("the journey", () => {
  it("orders legs by departure whatever order they were typed in", () => {
    const outbound = leg({ departAt: "2026-09-15T09:21" });
    const connection = leg({ departAt: "2026-09-15T16:19", from: "MCO", to: "CVG" });
    const home = leg({ departAt: "2026-09-20T17:37", from: "FLL", to: "DFW" });

    const ordered = legsInOrder({ legs: [home, connection, outbound] });

    expect(ordered.map((entry) => entry.departAt)).toEqual([
      "2026-09-15T09:21",
      "2026-09-15T16:19",
      "2026-09-20T17:37",
    ]);
  });

  it("does not mutate the stored order", () => {
    const legs = [leg({ departAt: "2026-09-20T17:37" }), leg({ departAt: "2026-09-15T09:21" })];
    legsInOrder({ legs });

    expect(legs[0]?.departAt).toBe("2026-09-20T17:37");
  });
});

describe("what a trip will accept", () => {
  it("takes a leg with a wall clock and a zone", () => {
    const parsed = tripSchema.safeParse({
      ...trip({
        legs: [
          leg({ number: "F9 4018", arriveAt: "2026-09-15T12:09", arriveTz: "America/New_York" }),
        ],
      }),
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses a departure carrying an offset", () => {
    // An offset would mean two sources of truth for the same moment — the
    // suffix and `departTz` — and nothing decides which wins.
    const parsed = tripSchema.safeParse(
      trip({ legs: [leg({ departAt: "2026-09-15T09:21-05:00" })] }),
    );

    expect(parsed.success).toBe(false);
  });

  it("refuses a zone that is not an IANA id", () => {
    const parsed = tripSchema.safeParse(trip({ legs: [leg({ departTz: "CST" })] }));

    expect(parsed.success).toBe(false);
  });

  it("refuses a trip with nobody away", () => {
    const parsed = tripSchema.safeParse(trip({ whoIsAway: "" }));

    expect(parsed.success).toBe(false);
  });

  it("leaves the ordering of the two dates to the domain", () => {
    // Zod checks one field at a time; a rule relating two of them lives in
    // `tripDatesAreOrdered` so the form and the use case share one answer.
    const backwards = trip({ startDate: new Date(2026, 8, 20), endDate: new Date(2026, 8, 15) });

    expect(tripSchema.safeParse(backwards).success).toBe(true);
    expect(tripDatesAreOrdered(backwards)).toBe(false);
    expect(tripDatesAreOrdered(trip())).toBe(true);
  });

  it("accepts a same-day trip", () => {
    const sameDay = trip({ startDate: new Date(2026, 8, 15), endDate: new Date(2026, 8, 15) });

    expect(tripDatesAreOrdered(sameDay)).toBe(true);
    expect(awayWindow(sameDay, new Date(2026, 8, 15, 12)).status).toBe("away");
  });
});
