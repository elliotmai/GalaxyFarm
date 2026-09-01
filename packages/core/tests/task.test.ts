import { describe, expect, it } from "vitest";

import {
  choreCalendarEntries,
  choreDaySheet,
  choreProgress,
  choreTemplateSchema,
  complete,
  isComplete,
  isOverdue,
  occurrenceId,
  occurrencesInWindow,
  occursOn,
  reopen,
  taskFromTemplate,
  taskSchema,
  type ChoreTemplate,
  type Task,
} from "../src/entities/task.js";
import { projectEvents } from "../src/entities/calendar-event.js";
import { encodeUlid, type Ulid } from "../src/types/ids.js";

let counter = 0;
const nextId = (): Ulid => encodeUlid(2_000 + counter++, () => 0.5);

const base = () => ({
  id: nextId(),
  propertyId: nextId(),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const task = (overrides: Partial<Task> = {}): Task => ({
  ...base(),
  title: "Break ice on the north tank",
  dueAt: new Date("2026-01-15T07:00:00Z"),
  ...overrides,
});

describe("Task", () => {
  it("validates", () => {
    expect(taskSchema.safeParse(task()).success).toBe(true);
  });

  it("requires a title", () => {
    expect(taskSchema.safeParse({ ...task(), title: "" }).success).toBe(false);
  });

  it("is overdue only when unfinished and past due", () => {
    const due = new Date("2026-01-15T07:00:00Z");
    const later = new Date("2026-01-16T07:00:00Z");

    expect(isOverdue({ dueAt: due, completedAt: undefined }, later)).toBe(true);
    expect(isOverdue({ dueAt: due, completedAt: undefined }, due)).toBe(false);
    expect(isOverdue({ dueAt: due, completedAt: later }, later)).toBe(false);
  });

  it("completes with who and when", () => {
    const at = new Date("2026-01-15T08:00:00Z");
    const by = nextId();
    const done = complete(task(), at, by);

    expect(isComplete(done)).toBe(true);
    expect(done.completedAt).toEqual(at);
    expect(done.completedBy).toBe(by);
    expect(done.updatedAt).toEqual(at);
  });

  it("reopens cleanly — fingers slip, especially with gloves on a kiosk", () => {
    const done = complete(task(), new Date("2026-01-15T08:00:00Z"), nextId());
    const undone = reopen(done, new Date("2026-01-15T09:00:00Z"));

    expect(isComplete(undone)).toBe(false);
    expect("completedAt" in undone).toBe(false);
    expect("completedBy" in undone).toBe(false);
  });
});

describe("ChoreTemplate recurrence", () => {
  const template = (
    recurrence: "once" | "daily" | "weekly" | "monthly" | "seasonal",
    days: number[] = [],
    active = true,
  ) => ({ recurrence, recurrenceDays: days, active });

  // 2026-01-15 is a Thursday (day 4).
  const thursday = new Date("2026-01-15T12:00:00Z");

  it("validates a template", () => {
    expect(
      choreTemplateSchema.safeParse({
        ...base(),
        title: "Feed the flock",
        recurrence: "daily",
        recurrenceDays: [],
        active: true,
      }).success,
    ).toBe(true);
  });

  it("accepts a part of the day, and rejects a word that is not one", () => {
    const timed = {
      ...base(),
      title: "Check the stalls",
      recurrence: "daily",
      recurrenceDays: [],
      timeOfDay: "morning",
      active: true,
    };

    expect(choreTemplateSchema.safeParse(timed).success).toBe(true);
    expect(choreTemplateSchema.safeParse({ ...timed, timeOfDay: "dawn" }).success).toBe(false);
  });

  it("never fires an inactive template", () => {
    expect(occursOn(template("daily", [], false), thursday)).toBe(false);
  });

  it("fires daily templates every day", () => {
    expect(occursOn(template("daily"), thursday)).toBe(true);
  });

  it("fires weekly templates on their weekday only", () => {
    expect(occursOn(template("weekly", [4]), thursday)).toBe(true);
    expect(occursOn(template("weekly", [1]), thursday)).toBe(false);
  });

  it("fires monthly templates on their day of month only", () => {
    expect(occursOn(template("monthly", [15]), thursday)).toBe(true);
    expect(occursOn(template("monthly", [1]), thursday)).toBe(false);
  });

  it("does not auto-generate one-off or seasonal templates", () => {
    // A one-off is created directly; seasonal work is driven by the calendar
    // and the weather service, not by a day-of-week rule.
    expect(occursOn(template("once"), thursday)).toBe(false);
    expect(occursOn(template("seasonal"), thursday)).toBe(false);
  });

  it("projects a window without writing rows ahead of time", () => {
    // Generation stays pure so editing a template leaves no stale future
    // instances behind.
    expect(occurrencesInWindow(template("daily"), thursday, 7)).toHaveLength(7);
    expect(occurrencesInWindow(template("weekly", [4]), thursday, 14)).toHaveLength(2);
    expect(occurrencesInWindow(template("once"), thursday, 30)).toHaveLength(0);
  });

  it("projects seven distinct days, including across a clock change", () => {
    // 8 March 2026 is the US spring-forward. Stepping by 24 hours lands on the
    // 8th twice and never reaches the 14th.
    const week = occurrencesInWindow(template("daily"), new Date(2026, 2, 8), 7);
    const dates = week.map((date) => date.getDate());

    expect(dates).toEqual([8, 9, 10, 11, 12, 13, 14]);
  });
});

describe("the chore day sheet", () => {
  // Local parts, not a UTC literal: the sheet answers in the day the person
  // standing in the barn is having, and a `Z` literal is a different date for
  // half the world.
  const thursday = new Date(2026, 0, 15);
  const morning = new Date(2026, 0, 15, 7, 30);
  const template = (overrides: Partial<ChoreTemplate> = {}): ChoreTemplate => ({
    ...base(),
    title: "Feed the flock",
    recurrence: "daily",
    recurrenceDays: [],
    active: true,
    ...overrides,
  });

  it("merges what was written down with what a template says is due", () => {
    const daily = template();
    const written = task({ title: "Fix the north gate", dueAt: new Date(2026, 0, 15, 9, 0) });

    const sheet = choreDaySheet({ tasks: [written], templates: [daily] }, thursday, morning);

    expect(sheet.map((entry) => entry.title)).toEqual(["Fix the north gate", "Feed the flock"]);
    expect(sheet[0]?.taskId).toBe(written.id);
    expect(sheet[1]?.taskId).toBeUndefined();
    expect(sheet[1]?.templateId).toBe(daily.id);
  });

  it("gives an untouched occurrence an id that survives recomputation", () => {
    const daily = template();
    const input = { tasks: [], templates: [daily] };

    const first = choreDaySheet(input, thursday, morning);
    const second = choreDaySheet(input, thursday, new Date(2026, 0, 15, 8, 0));

    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.id).toBe(occurrenceId(daily.id, thursday));
  });

  it("stops generating an occurrence once its row exists", () => {
    const daily = template();
    const ticked = task({
      title: daily.title,
      templateId: daily.id,
      dueAt: new Date(2026, 0, 15, 23, 59, 59, 999),
      completedAt: new Date(2026, 0, 15, 6, 15),
    });

    const sheet = choreDaySheet({ tasks: [ticked], templates: [daily] }, thursday, morning);

    // One line, not two. A ticked chore that reappears underneath itself is
    // how a list stops being trusted.
    expect(sheet).toHaveLength(1);
    expect(sheet[0]?.completedAt).toBeDefined();
  });

  it("carries a written-down chore forward until it is done", () => {
    const missed = task({ title: "Worm the bull", dueAt: new Date(2026, 0, 12, 9, 0) });

    const sheet = choreDaySheet({ tasks: [missed], templates: [] }, thursday, morning);

    expect(sheet).toHaveLength(1);
    expect(sheet[0]?.carriedOver).toBe(true);
    expect(sheet[0]?.overdue).toBe(true);
  });

  it("does not carry a finished chore into every day after it", () => {
    const done = task({
      dueAt: new Date(2026, 0, 12, 9, 0),
      completedAt: new Date(2026, 0, 12, 9, 30),
    });

    expect(choreDaySheet({ tasks: [done], templates: [] }, thursday, morning)).toEqual([]);
  });

  it("does not stack a daily template up behind itself", () => {
    // Tuesday's un-ticked "feed the flock" is not still owed on Thursday — the
    // flock was fed or it was not. Tuesday's sheet still shows it missed.
    const sheet = choreDaySheet({ tasks: [], templates: [template()] }, thursday, morning);

    expect(sheet).toHaveLength(1);
    expect(sheet[0]?.carriedOver).toBe(false);
  });

  it("holds a template's chore open until the day is over", () => {
    // A template says which day, never which hour, so it cannot be late at
    // breakfast.
    const input = { tasks: [], templates: [template()] };

    expect(choreDaySheet(input, thursday, morning)[0]?.overdue).toBe(false);
    expect(choreDaySheet(input, thursday, new Date(2026, 0, 16, 0, 1))[0]?.overdue).toBe(true);
  });

  it("turns a timed template's chore late when its part of the day passes", () => {
    // A template that names a part of the day keeps the same clock a feeding
    // round does: the morning check unfinished at noon is late at noon, not
    // hidden among everything else until midnight.
    const input = { tasks: [], templates: [template({ timeOfDay: "morning" })] };
    const noon = new Date(2026, 0, 15, 12, 0);

    expect(choreDaySheet(input, thursday, morning)[0]?.overdue).toBe(false);
    expect(choreDaySheet(input, thursday, noon)[0]?.overdue).toBe(true);
    expect(choreDaySheet(input, thursday, noon)[0]?.dueAt).toEqual(
      new Date(2026, 0, 15, 11, 0, 59, 999),
    );
  });

  it("reads a past day as that day, not as now", () => {
    // Stepping back must not mark yesterday's evening chores as still in hand,
    // and stepping forward must not mark tomorrow's as late.
    const wednesday = new Date(2026, 0, 14);
    const input = { tasks: [], templates: [template()] };

    expect(choreDaySheet(input, wednesday, morning)[0]?.overdue).toBe(true);
    expect(choreDaySheet(input, new Date(2026, 0, 16), morning)[0]?.overdue).toBe(false);
  });

  it("ignores a template that does not fire on the day asked for", () => {
    // 15 January 2026 is a Thursday.
    const monday = template({ recurrence: "weekly", recurrenceDays: [1] });
    const inactive = template({ active: false });

    expect(choreDaySheet({ tasks: [], templates: [monday, inactive] }, thursday, morning)).toEqual(
      [],
    );
  });

  it("orders the oldest debt first", () => {
    const sheet = choreDaySheet(
      {
        tasks: [
          task({ title: "Evening feed", dueAt: new Date(2026, 0, 15, 17, 0) }),
          task({ title: "Worm the bull", dueAt: new Date(2026, 0, 12, 9, 0) }),
          task({ title: "Morning feed", dueAt: new Date(2026, 0, 15, 6, 0) }),
        ],
        templates: [],
      },
      thursday,
      morning,
    );

    expect(sheet.map((entry) => entry.title)).toEqual([
      "Worm the bull",
      "Morning feed",
      "Evening feed",
    ]);
  });

  it("writes a template's chore down only when it is ticked", () => {
    const daily = template({ detail: "Two scoops", zoneId: nextId() });
    const fields = taskFromTemplate(daily, thursday);

    expect(fields.templateId).toBe(daily.id);
    expect(fields.title).toBe(daily.title);
    expect(fields.detail).toBe("Two scoops");
    expect(fields.zoneId).toBe(daily.zoneId);
    // End of day, so the row lands on the day it was generated for and the
    // occurrence it replaces stops being generated.
    expect(fields.dueAt).toEqual(new Date(2026, 0, 15, 23, 59, 59, 999));
  });

  it("writes a timed template's chore down with the same deadline it showed", () => {
    // The projection and the row it becomes must agree, or ticking a chore
    // moves the moment it would have counted late.
    const fields = taskFromTemplate(template({ timeOfDay: "evening" }), thursday);

    expect(fields.dueAt).toEqual(new Date(2026, 0, 15, 20, 0, 59, 999));
  });

  it("counts the day in one line", () => {
    const sheet = choreDaySheet(
      {
        tasks: [
          task({ title: "Worm the bull", dueAt: new Date(2026, 0, 12, 9, 0) }),
          task({
            title: "Morning feed",
            dueAt: new Date(2026, 0, 15, 6, 0),
            completedAt: new Date(2026, 0, 15, 6, 20),
          }),
        ],
        templates: [template()],
      },
      thursday,
      morning,
    );

    expect(choreProgress(sheet)).toEqual({
      total: 3,
      done: 1,
      open: 2,
      overdue: 1,
      fraction: 1 / 3,
    });
  });

  it("reports an empty day as nothing to do rather than as NaN", () => {
    expect(choreProgress([])).toEqual({ total: 0, done: 0, open: 0, overdue: 0, fraction: 0 });
  });
});

describe("chores on the unified calendar", () => {
  const thursday = new Date(2026, 0, 15);
  const morning = new Date(2026, 0, 15, 7, 30);
  const template = (overrides: Partial<ChoreTemplate> = {}): ChoreTemplate => ({
    ...base(),
    title: "Feed the flock",
    recurrence: "daily",
    recurrenceDays: [],
    active: true,
    ...overrides,
  });

  it("projects one row per day a template fires", () => {
    const weekly = template({
      title: "Move the hot wire",
      recurrence: "weekly",
      recurrenceDays: [4],
    });

    const entries = choreCalendarEntries({ tasks: [], templates: [weekly] }, thursday, 14, morning);

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.kind === "chore")).toBe(true);
    expect(entries.every((entry) => entry.module === "chores")).toBe(true);
    expect(entries[1]?.at.getDate()).toBe(22);
  });

  it("gives every row the same id the second time round", () => {
    const input = {
      tasks: [task({ dueAt: new Date(2026, 0, 16, 9, 0) })],
      templates: [template()],
    };

    const first = choreCalendarEntries(input, thursday, 7, morning);
    const second = choreCalendarEntries(input, thursday, 7, new Date(2026, 0, 15, 11, 0));

    expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id));
    expect(new Set(first.map((entry) => entry.id)).size).toBe(first.length);
  });

  it("leaves an owed chore on the day it was due, not on every day after it", () => {
    // `choreDaySheet` deliberately carries an un-ticked written-down chore
    // forward, which is right for a day sheet and would paint a fortnight-old
    // chore across the whole month here.
    const missed = task({ title: "Fix the north gate", dueAt: new Date(2026, 0, 10, 9, 0) });

    const entries = choreCalendarEntries({ tasks: [missed], templates: [] }, thursday, 14, morning);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.at).toEqual(missed.dueAt);
    expect(entries[0]?.source).toEqual({ entity: "tasks", id: missed.id });
  });

  it("shows the stored row rather than the occurrence once a chore is ticked", () => {
    const daily = template();
    const ticked = task({
      ...taskFromTemplate(daily, thursday),
      completedAt: morning,
    });

    const entries = choreCalendarEntries(
      { tasks: [ticked], templates: [daily] },
      thursday,
      1,
      morning,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toEqual({ entity: "tasks", id: ticked.id });
  });

  it("moves the row when the template's day is corrected", () => {
    const wrong = template({ recurrence: "weekly", recurrenceDays: [4] });
    const fixed = { ...wrong, recurrenceDays: [5] };

    const before = choreCalendarEntries({ tasks: [], templates: [wrong] }, thursday, 7, morning);
    const after = choreCalendarEntries({ tasks: [], templates: [fixed] }, thursday, 7, morning);

    expect(before[0]?.at.getDate()).toBe(15);
    expect(after[0]?.at.getDate()).toBe(16);
    // Nothing is stored, so the old day leaves no row behind to go stale.
    expect(after).toHaveLength(1);
  });

  it("merges into the calendar under the chores filter", () => {
    const entries = choreCalendarEntries(
      { tasks: [], templates: [template()] },
      thursday,
      3,
      morning,
    );

    const merged = projectEvents({ manual: [], projected: entries }, undefined, ["chores"]);
    expect(merged).toHaveLength(3);
    expect(projectEvents({ manual: [], projected: entries }, undefined, ["cattle"])).toEqual([]);
  });
});
