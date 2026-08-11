import { describe, expect, it } from "vitest";

import {
  choreTemplateSchema,
  complete,
  isComplete,
  isOverdue,
  occurrencesInWindow,
  occursOn,
  reopen,
  taskSchema,
  type Task,
} from "../src/entities/task.js";
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
});
