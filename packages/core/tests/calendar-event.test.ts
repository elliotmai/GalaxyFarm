import { describe, expect, it } from "vitest";

import {
  CALENDAR_EVENT_KINDS,
  EVENT_KIND_MODULE,
  calendarEventSchema,
  entryFromEvent,
  groupByDay,
  projectEvents,
  projectedId,
  type CalendarEntry,
  type CalendarEvent,
} from "../src/entities/calendar-event.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * The unified calendar (spec §5.1, §6).
 *
 * A read model with one stored half. The tests worth having are about the
 * merge: that a window overlapping the month shows up in it, that filtering by
 * module does not quietly drop manual events, and that a projected row's id is
 * the same the second time it is computed.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");

const manual = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: id(1),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  title: "Farrier",
  at: new Date("2026-11-12T15:00:00Z"),
  allDay: false,
  ...over,
});

const projected = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: projectedId("calving_window", "breedingRecord", id(5)),
  kind: "calving_window",
  module: "cattle",
  title: "Andromeda — calving window",
  at: new Date("2026-11-10T00:00:00Z"),
  endAt: new Date("2026-12-08T00:00:00Z"),
  allDay: true,
  source: { entity: "breedingRecord", id: id(5) },
  ...over,
});

describe("every event kind belongs to a module", () => {
  it("maps all of them, so the §6 module filter cannot silently hide a kind", () => {
    const unmapped = CALENDAR_EVENT_KINDS.filter((kind) => EVENT_KIND_MODULE[kind] === undefined);
    expect(unmapped).toEqual([]);
  });
});

describe("projectedId", () => {
  it("is stable across recomputation", () => {
    // Recomputed rows get new React keys and lose "I've seen that" state if the
    // id is generated rather than derived.
    expect(projectedId("withdrawal_end", "healthRecord", id(7))).toBe(
      projectedId("withdrawal_end", "healthRecord", id(7)),
    );
  });

  it("distinguishes two kinds derived from the same record", () => {
    // One breeding record produces both a preg-check due date and a calving
    // window. Colliding ids would render one of them.
    expect(projectedId("preg_check_due", "breedingRecord", id(5))).not.toBe(
      projectedId("calving_window", "breedingRecord", id(5)),
    );
  });
});

describe("projectEvents", () => {
  it("merges the stored and projected halves into one ordered list", () => {
    const merged = projectEvents({ manual: [manual()], projected: [projected()] });
    expect(merged.map((entry) => entry.title)).toEqual(["Andromeda — calving window", "Farrier"]);
  });

  it("keeps a window that straddles the edge of the view", () => {
    // A calving window that opened in November is still the most important
    // thing on December's calendar.
    const december = { from: new Date("2026-12-01"), to: new Date("2026-12-31") };
    const merged = projectEvents({ manual: [], projected: [projected()] }, december);

    expect(merged).toHaveLength(1);
  });

  it("excludes what falls entirely outside the window", () => {
    const january = { from: new Date("2027-01-01"), to: new Date("2027-01-31") };
    expect(projectEvents({ manual: [manual()], projected: [projected()] }, january)).toEqual([]);
  });

  it("keeps an instant sitting exactly on the first moment of the window", () => {
    // The month boundary is not a rare case — every recurring monthly thing
    // lands on it. Treating an instant as a zero-length range would drop it
    // from the month it belongs to and from every other month too.
    const november = {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-12-01T00:00:00Z"),
    };
    const midnight = manual({ at: new Date("2026-11-01T00:00:00Z") });

    expect(projectEvents({ manual: [midnight], projected: [] }, november)).toHaveLength(1);
  });

  it("puts an instant on the closing edge into the next window, not this one", () => {
    // Half-open, so a month owns its first moment and not its last. Otherwise
    // midnight on the 1st appears twice, in two different months.
    const november = {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-12-01T00:00:00Z"),
    };
    const boundary = manual({ at: new Date("2026-12-01T00:00:00Z") });

    expect(projectEvents({ manual: [boundary], projected: [] }, november)).toEqual([]);
  });

  it("filters by module without losing manual events when general is asked for", () => {
    const cattleOnly = projectEvents({ manual: [manual()], projected: [projected()] }, undefined, [
      "cattle",
    ]);
    expect(cattleOnly.map((e) => e.kind)).toEqual(["calving_window"]);

    const generalOnly = projectEvents({ manual: [manual()], projected: [projected()] }, undefined, [
      "general",
    ]);
    expect(generalOnly.map((e) => e.kind)).toEqual(["manual"]);
  });

  it("breaks ties on id so two events at the same instant do not reorder", () => {
    const a = projected({ id: "a", at: AT, endAt: undefined });
    const b = projected({ id: "b", at: AT, endAt: undefined });

    expect(projectEvents({ manual: [], projected: [b, a] }).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("entryFromEvent", () => {
  it("carries no source, which is what marks it as hand-entered", () => {
    expect(entryFromEvent(manual()).source).toBeUndefined();
    expect(entryFromEvent(manual()).kind).toBe("manual");
  });
});

describe("groupByDay", () => {
  it("buckets an agenda by local date", () => {
    const morning = projected({ id: "m", at: new Date(2026, 10, 12, 8), endAt: undefined });
    const evening = projected({ id: "e", at: new Date(2026, 10, 12, 19), endAt: undefined });
    const nextDay = projected({ id: "n", at: new Date(2026, 10, 13, 9), endAt: undefined });

    const days = groupByDay(projectEvents({ manual: [], projected: [morning, evening, nextDay] }));

    expect([...days.keys()]).toEqual(["2026-11-12", "2026-11-13"]);
    expect(days.get("2026-11-12")).toHaveLength(2);
  });
});

describe("calendarEventSchema", () => {
  it("refuses an event that ends before it starts", () => {
    const result = calendarEventSchema.safeParse({
      ...manual(),
      at: new Date("2026-11-12T15:00:00Z"),
      endAt: new Date("2026-11-12T14:00:00Z"),
    });

    expect(result.success).toBe(false);
  });

  it("accepts an instant with no end at all", () => {
    expect(calendarEventSchema.safeParse(manual()).success).toBe(true);
  });
});
