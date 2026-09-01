import { describe, expect, it } from "vitest";

import {
  encodeUlid,
  type ChoreEntry,
  type ChoreTemplate,
  type CrudError,
  type Result,
  type Task,
  type Ulid,
} from "@galaxy-farm/core";

import {
  dayLabel,
  describeRecurrence,
  describeTimeOfDay,
  groupChoresForBoard,
  parseMonthDays,
  toggleChore,
} from "../lib/chores.js";
import type { Mutations } from "../lib/local/mutations.js";

/**
 * Ticking a chore off (§6).
 *
 * Two of the three paths through this are easy to get wrong in ways nothing
 * would notice for a week: writing an empty row and then completing it leaves
 * a window where a chore exists that nobody did, and un-ticking by dropping
 * the fields rather than clearing them leaves the chore reading as done on
 * every device except the one that un-ticked it.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const date = new Date(2026, 0, 15);
const at = new Date(2026, 0, 15, 7, 30);

interface Call {
  readonly kind: "create" | "update" | "remove" | "restore";
  readonly id?: Ulid;
  readonly fields: Record<string, unknown>;
}

/** Records what a screen asked for, without a store underneath it. */
function spy(): { calls: Call[]; api: Mutations<Task> } {
  const calls: Call[] = [];
  const ok = (fields: Record<string, unknown>): Promise<Result<Task, CrudError>> =>
    Promise.resolve({ ok: true, value: fields as unknown as Task });

  return {
    calls,
    api: {
      create: (fields) => {
        calls.push({ kind: "create", fields: fields as Record<string, unknown> });
        return ok(fields as Record<string, unknown>);
      },
      update: (id, patch) => {
        calls.push({ kind: "update", id, fields: patch as Record<string, unknown> });
        return ok(patch as Record<string, unknown>);
      },
      remove: (id) => {
        calls.push({ kind: "remove", id, fields: {} });
        return ok({});
      },
      restoreRecord: (id) => {
        calls.push({ kind: "restore", id, fields: {} });
        return ok({});
      },
    },
  };
}

const template: ChoreTemplate = {
  id: encodeUlid(1) as Ulid,
  propertyId: PROPERTY,
  createdAt: date,
  updatedAt: date,
  title: "Feed the flock",
  detail: "Two scoops",
  recurrence: "daily",
  recurrenceDays: [],
  active: true,
};

const projected: ChoreEntry = {
  id: `occurrence:${template.id}:2026-01-15`,
  title: template.title,
  dueAt: new Date(2026, 0, 15, 23, 59, 59, 999),
  templateId: template.id,
  carriedOver: false,
  overdue: false,
};

const stored: ChoreEntry = {
  id: encodeUlid(2) as Ulid,
  title: "Fix the north gate",
  dueAt: new Date(2026, 0, 15, 9, 0),
  taskId: encodeUlid(2) as Ulid,
  carriedOver: false,
  overdue: false,
};

describe("toggleChore", () => {
  it("writes a projected chore down already finished, in one patch", async () => {
    const { calls, api } = spy();

    await toggleChore(api, { entry: projected, template, date, at, actorId: ACTOR });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("create");
    expect(calls[0]?.fields).toMatchObject({
      templateId: template.id,
      title: "Feed the flock",
      detail: "Two scoops",
      completedAt: at,
      completedBy: ACTOR,
    });
  });

  it("dates that row to the day it was shown for, not to now", async () => {
    // Ticking yesterday's list off this morning records yesterday's chore.
    const { calls, api } = spy();

    await toggleChore(api, {
      entry: projected,
      template,
      date: new Date(2026, 0, 14),
      at,
      actorId: ACTOR,
    });

    expect(calls[0]?.fields["dueAt"]).toEqual(new Date(2026, 0, 14, 23, 59, 59, 999));
  });

  it("completes a stored chore in place", async () => {
    const { calls, api } = spy();

    await toggleChore(api, { entry: stored, template: undefined, date, at, actorId: ACTOR });

    expect(calls[0]?.kind).toBe("update");
    expect(calls[0]?.id).toBe(stored.taskId);
    expect(calls[0]?.fields).toEqual({ completedAt: at, completedBy: ACTOR });
  });

  it("clears the fields by name when un-ticking", async () => {
    // Not by omitting them. A patch carries the fields that changed, and a key
    // that is absent is not a change — the chore would stay done everywhere
    // else on the farm.
    const { calls, api } = spy();
    const done: ChoreEntry = { ...stored, completedAt: at, completedBy: ACTOR };

    await toggleChore(api, { entry: done, template: undefined, date, at, actorId: ACTOR });

    expect(Object.keys(calls[0]?.fields ?? {}).sort()).toEqual(["completedAt", "completedBy"]);
    expect(calls[0]?.fields["completedAt"]).toBeUndefined();
    expect(calls[0]?.fields["completedBy"]).toBeUndefined();
  });

  it("writes nothing when the template behind an occurrence has gone", async () => {
    // Deleted between the render and the tap. Better a failure the screen can
    // report than a chore with no title.
    const { calls, api } = spy();

    const result = await toggleChore(api, {
      entry: projected,
      template: undefined,
      date,
      at,
      actorId: ACTOR,
    });

    expect(calls).toEqual([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-found");
  });
});

describe("dayLabel", () => {
  const today = new Date(2026, 0, 15);

  it("gives the three near days words", () => {
    expect(dayLabel(new Date(2026, 0, 15, 18, 0), today)).toBe("Today");
    expect(dayLabel(new Date(2026, 0, 14), today)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 0, 16), today)).toBe("Tomorrow");
  });

  it("names anything further out", () => {
    // "Three days ago" is a sum. A date is not.
    const label = dayLabel(new Date(2026, 0, 12), today);

    expect(label).not.toMatch(/Today|Yesterday|Tomorrow/);
    expect(label).toMatch(/12/);
  });

  it("steps across a month end without arithmetic on the hours", () => {
    const marchFirst = new Date(2026, 2, 1);

    expect(dayLabel(new Date(2026, 1, 28), marchFirst)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 2, 2), marchFirst)).toBe("Tomorrow");
  });
});

describe("parseMonthDays", () => {
  it("reads a box typed in a hurry", () => {
    expect(parseMonthDays("1, 15")).toEqual([1, 15]);
    expect(parseMonthDays("15 1")).toEqual([1, 15]);
    expect(parseMonthDays(" 15,,1 , 15 ")).toEqual([1, 15]);
  });

  it("drops what a month cannot have", () => {
    // Rejecting the whole box because one number in it is 32 loses the four
    // that were right.
    expect(parseMonthDays("0, 1, 31, 32, -3, tuesday")).toEqual([1, 31]);
    expect(parseMonthDays("")).toEqual([]);
  });
});

describe("describeRecurrence", () => {
  it("says what a rule does", () => {
    expect(describeRecurrence({ recurrence: "daily", recurrenceDays: [] })).toBe("Every day");
    expect(describeRecurrence({ recurrence: "weekly", recurrenceDays: [1, 4] })).toBe(
      "Every Monday, Thursday",
    );
    expect(describeRecurrence({ recurrence: "monthly", recurrenceDays: [1, 15] })).toBe(
      "On the 1, 15 of each month",
    );
  });

  it("says out loud when a rule fires on nothing", () => {
    // Both of these validate and then produce no chores at all, which reads as
    // the feature being broken rather than the rule being half-written.
    expect(describeRecurrence({ recurrence: "weekly", recurrenceDays: [] })).toContain(
      "never fires",
    );
    expect(describeRecurrence({ recurrence: "monthly", recurrenceDays: [] })).toContain(
      "never fires",
    );
    expect(describeRecurrence({ recurrence: "once", recurrenceDays: [] })).toContain("One-off");
    expect(describeRecurrence({ recurrence: "seasonal", recurrenceDays: [] })).toContain(
      "not generated yet",
    );
  });
});

describe("describeTimeOfDay", () => {
  it("says the deadline out loud, because that is the surprising half", () => {
    expect(describeTimeOfDay("morning")).toBe("Morning — late after 11 am");
    expect(describeTimeOfDay("midday")).toBe("Midday — late after 2 pm");
    expect(describeTimeOfDay("evening")).toBe("Evening — late after 8 pm");
  });

  it("does not invent 11:59 pm for night, which is just the end of the day", () => {
    expect(describeTimeOfDay("night")).toBe("Night — due by the end of the day");
  });
});

describe("groupChoresForBoard", () => {
  let counter = 0;
  const entry = (overrides: Partial<ChoreEntry>): ChoreEntry => ({
    id: `entry-${++counter}`,
    title: "A chore",
    dueAt: new Date(2026, 0, 15, 23, 59, 59, 999),
    carriedOver: false,
    overdue: false,
    ...overrides,
  });

  it("sections the day the way it is worked, and only the parts that have work", () => {
    const sections = groupChoresForBoard([
      entry({ dueAt: new Date(2026, 0, 15, 20, 0, 59, 999) }),
      entry({ dueAt: new Date(2026, 0, 15, 11, 0, 59, 999) }),
      entry({ dueAt: new Date(2026, 0, 15, 23, 59, 59, 999) }),
    ]);

    // No midday work, no midday heading — an empty section reads as broken.
    expect(sections.map((section) => section.label)).toEqual([
      "Morning",
      "Evening",
      "Night & any time",
    ]);
  });

  it("puts what is owed from earlier first, because it is already late", () => {
    const sections = groupChoresForBoard([
      entry({ dueAt: new Date(2026, 0, 15, 11, 0, 59, 999) }),
      entry({ dueAt: new Date(2026, 0, 12, 9, 0), carriedOver: true, overdue: true }),
    ]);

    expect(sections[0]?.label).toBe("Owed from earlier");
  });

  it("files an untimed chore with the night feeds, which share its deadline", () => {
    // Night's deadline is the end of the day — the same moment every untimed
    // chore is due — so the two share a heading rather than pretending the
    // arithmetic can tell them apart.
    const sections = groupChoresForBoard([
      entry({ dueAt: new Date(2026, 0, 15, 14, 0, 59, 999) }),
      entry({}),
    ]);

    expect(sections.map((section) => section.label)).toEqual(["Midday", "Night & any time"]);
  });

  it("keeps a section's entries flat and in the order they arrived", () => {
    // The day sheet already sorted them by when they are due; a board that
    // reshuffled inside a section would disagree with every other surface.
    const morning = new Date(2026, 0, 15, 11, 0, 59, 999);
    const sections = groupChoresForBoard([
      entry({ dueAt: morning, title: "Morning feed · Senior ration" }),
      entry({ dueAt: morning, title: "Check the water" }),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.entries.map((item) => item.title)).toEqual([
      "Morning feed · Senior ration",
      "Check the water",
    ]);
  });

  it("sinks the finished ones to the bottom of their section, in their order", () => {
    // What is left to do reads from the top; the ticked ones stay visible
    // underneath as the record of the round.
    const morning = new Date(2026, 0, 15, 11, 0, 59, 999);
    const ticked = new Date(2026, 0, 15, 6, 30);
    const sections = groupChoresForBoard([
      entry({ dueAt: morning, title: "First, done", completedAt: ticked }),
      entry({ dueAt: morning, title: "Second, open" }),
      entry({ dueAt: morning, title: "Third, done", completedAt: ticked }),
      entry({ dueAt: morning, title: "Fourth, open" }),
    ]);

    expect(sections[0]?.entries.map((item) => item.title)).toEqual([
      "Second, open",
      "Fourth, open",
      "First, done",
      "Third, done",
    ]);
  });
});
