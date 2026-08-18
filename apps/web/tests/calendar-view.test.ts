import { describe, expect, it } from "vitest";

import { dayKey, type CalendarEntry } from "@galaxy-farm/core";

import {
  AGENDA_DAYS,
  calendarPeriod,
  groupFromDay,
  groupOverSpan,
  stepPeriod,
} from "../lib/calendar-view";

/**
 * The month, week and agenda spans (spec §6).
 *
 * Month boundaries are where calendars quietly go wrong, so the cases below
 * are the awkward ones: a month whose 1st is a Sunday, stepping from the 31st
 * into a month with 30 days, and a week that straddles two months.
 *
 * Local dates throughout, not UTC literals — the day somebody is having in the
 * barn is a local day, and `2026-08-01T00:00:00Z` is 31 July in Texas.
 */

describe("the month span", () => {
  it("draws whole weeks, starting on the Sunday on or before the 1st", () => {
    // August 2026 begins on a Saturday, so the grid opens on 26 July.
    const period = calendarPeriod("month", new Date(2026, 7, 11));

    expect(dayKey(period.from)).toBe("2026-07-26");
    expect(period.from.getDay()).toBe(0);
    expect(period.days % 7).toBe(0);
    expect(dayKey(period.to)).toBe("2026-09-06");
    expect(period.title).toContain("2026");
  });

  it("adds no empty leading row when the 1st is already a Sunday", () => {
    // November 2026 begins on a Sunday. A grid that still reached back a week
    // would show seven October days nobody asked for and push the month down.
    const period = calendarPeriod("month", new Date(2026, 10, 15));

    expect(dayKey(period.from)).toBe("2026-11-01");
    expect(period.days).toBe(35);
  });

  it("keeps the month it is about, so outside days can be dimmed", () => {
    expect(calendarPeriod("month", new Date(2026, 7, 11)).month).toBe(7);
  });
});

describe("the week span", () => {
  it("runs Sunday to Saturday around the chosen day", () => {
    const period = calendarPeriod("week", new Date(2026, 7, 11));

    expect(dayKey(period.from)).toBe("2026-08-09");
    expect(period.days).toBe(7);
    expect(dayKey(period.to)).toBe("2026-08-16");
  });

  it("names both months when the week straddles two", () => {
    const period = calendarPeriod("week", new Date(2026, 7, 31));
    expect(period.title).toMatch(/Aug/);
    expect(period.title).toMatch(/September/);
  });
});

describe("the agenda span", () => {
  it("starts on the chosen day and runs forward", () => {
    const period = calendarPeriod("agenda", new Date(2026, 7, 11, 18, 30));

    expect(dayKey(period.from)).toBe("2026-08-11");
    expect(period.days).toBe(AGENDA_DAYS);
    expect(dayKey(period.to)).toBe("2026-09-10");
  });
});

describe("stepping", () => {
  it("steps a month from the 1st, so a 31st never skips a 30-day month", () => {
    // Stepping 31 August forward by adding a month to the 31st lands on 1
    // October, and September is never drawn at all.
    const next = stepPeriod("month", new Date(2026, 7, 31), 1);

    expect(next.getMonth()).toBe(8);
    expect(next.getDate()).toBe(1);
  });

  it("steps a week by seven days and the agenda by its own length", () => {
    expect(dayKey(stepPeriod("week", new Date(2026, 7, 11), 1))).toBe("2026-08-18");
    expect(dayKey(stepPeriod("week", new Date(2026, 7, 11), -1))).toBe("2026-08-04");
    expect(dayKey(stepPeriod("agenda", new Date(2026, 7, 11), 1))).toBe("2026-09-10");
  });

  it("comes back where it started, forwards then back", () => {
    const start = new Date(2026, 0, 1);
    const there = stepPeriod("month", start, 1);
    expect(dayKey(stepPeriod("month", there, -1))).toBe(dayKey(start));
  });
});

describe("grouping for the grid", () => {
  const entry = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
    id: "calving_window:breedingRecords:x",
    kind: "calving_window",
    module: "cattle",
    title: "Andromeda — calving window",
    at: new Date(2026, 10, 10),
    endAt: new Date(2026, 10, 25),
    allDay: true,
    ...over,
  });

  it("fills every day a window covers, half-open at the far end", () => {
    const grid = groupOverSpan([entry()], new Date(2026, 10, 1), 30);

    expect(grid.get("2026-11-09")).toEqual([]);
    expect(grid.get("2026-11-10")).toHaveLength(1);
    expect(grid.get("2026-11-18")).toHaveLength(1);
    // Closing at midnight on the 25th means the 24th is the last day inside it.
    expect(grid.get("2026-11-24")).toHaveLength(1);
    expect(grid.get("2026-11-25")).toEqual([]);
  });

  it("puts an instant on exactly one day", () => {
    const grid = groupOverSpan(
      [entry({ at: new Date(2026, 10, 12, 15, 0), endAt: undefined })],
      new Date(2026, 10, 1),
      30,
    );

    expect(grid.get("2026-11-12")).toHaveLength(1);
    expect(grid.get("2026-11-13")).toEqual([]);
  });

  it("keeps a cell for every day, so an empty day is a cell and not a gap", () => {
    expect(groupOverSpan([], new Date(2026, 10, 1), 30).size).toBe(30);
  });
});

describe("grouping for the agenda", () => {
  it("files a row already under way under the first day on the list", () => {
    // Otherwise a fortnight that opened on the 10th gets a heading dated the
    // 10th on a list that starts on the 12th.
    const running: CalendarEntry = {
      id: "calving_window:breedingRecords:x",
      kind: "calving_window",
      module: "cattle",
      title: "Andromeda — calving window",
      at: new Date(2026, 10, 10),
      endAt: new Date(2026, 10, 25),
      allDay: true,
    };

    const days = groupFromDay([running], new Date(2026, 10, 12));

    expect([...days.keys()]).toEqual(["2026-11-12"]);
  });
});
