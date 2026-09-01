import { z } from "zod";

import { addCalendarDays, dayKey, endOfDay, startOfDay } from "../value-objects/date-range.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { projectedId, type CalendarEntry } from "./calendar-event.js";
import { TIMES_OF_DAY, type TimeOfDay } from "./feeding-plan.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * Chores (spec §5.1, §6). Templates generate dated instances; instances get
 * checked off, from the kiosk with a gloved hand more often than not.
 */

export const RECURRENCES = ["once", "daily", "weekly", "monthly", "seasonal"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/**
 * When a part of the day stops being on time.
 *
 * Shared by every chore that names a part of the day — a feeding line always
 * does, a template may. Generous rather than exact: these are the hours by
 * which it should have happened, not the hours it happens at, and an animal
 * that has not been fed by eleven is a thing to know about at eleven.
 */
export const TIME_OF_DAY_DEADLINES: Readonly<
  Record<TimeOfDay, { readonly hour: number; readonly minute: number }>
> = {
  morning: { hour: 11, minute: 0 },
  midday: { hour: 14, minute: 0 },
  evening: { hour: 20, minute: 0 },
  night: { hour: 23, minute: 59 },
};

export const TIME_OF_DAY_LABELS: Readonly<Record<TimeOfDay, string>> = {
  morning: "Morning",
  midday: "Midday",
  evening: "Evening",
  night: "Night",
};

export function timeOfDayDeadline(date: Date, timeOfDay: TimeOfDay): Date {
  const { hour, minute } = TIME_OF_DAY_DEADLINES[timeOfDay];
  const at = startOfDay(date);
  at.setHours(hour, minute, 59, 999);
  return at;
}

export interface ChoreTemplate extends BaseRecord {
  readonly title: string;
  readonly detail?: string | undefined;
  readonly recurrence: Recurrence;
  /** For weekly: 0 = Sunday. For monthly: day of month. */
  readonly recurrenceDays: readonly number[];
  /**
   * The part of the day it belongs to, when it has one.
   *
   * Absent means the whole day: the instance is due at the end of it, which is
   * what every template meant before this field existed. Named, the instance
   * is due by that part's deadline instead — the morning stall check turns
   * late at eleven, not at midnight, the same arithmetic a feeding line uses.
   */
  readonly timeOfDay?: TimeOfDay | undefined;
  readonly zoneId?: Ulid | undefined;
  readonly animalId?: Ulid | undefined;
  readonly active: boolean;
}

export interface Task extends BaseRecord {
  readonly templateId?: Ulid | undefined;
  /**
   * The derived occurrence this row is the answer to.
   *
   * A chore template's instance is matched by `templateId` plus its day, which
   * works because a template is a record with an id. A feeding chore has no
   * such record behind it: it is the sum of however many plans happened to
   * land on one trip, and that sum can change tomorrow without making today's
   * tick wrong. So the row carries the occurrence's own derived id, and the
   * day sheet drops any occurrence a stored row already claims.
   */
  readonly sourceKey?: string | undefined;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly dueAt: Date;
  readonly completedAt?: Date | undefined;
  readonly completedBy?: Ulid | undefined;
  readonly assignedTo?: Ulid | undefined;
  readonly zoneId?: Ulid | undefined;
  readonly animalId?: Ulid | undefined;
}

export const choreTemplateSchema = baseRecordSchema.extend({
  title: z.string().min(1, "A chore needs a title").max(120),
  detail: z.string().max(2000).optional(),
  recurrence: z.enum(RECURRENCES),
  recurrenceDays: z.array(z.number().int().min(0).max(31)),
  timeOfDay: z.enum(TIMES_OF_DAY).optional(),
  zoneId: ulidSchema.optional(),
  animalId: ulidSchema.optional(),
  active: z.boolean(),
}) as unknown as z.ZodType<ChoreTemplate>;

export const taskSchema = baseRecordSchema.extend({
  templateId: ulidSchema.optional(),
  sourceKey: z.string().max(200).optional(),
  title: z.string().min(1).max(120),
  detail: z.string().max(2000).optional(),
  dueAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  completedBy: ulidSchema.optional(),
  assignedTo: ulidSchema.optional(),
  zoneId: ulidSchema.optional(),
  animalId: ulidSchema.optional(),
}) as unknown as z.ZodType<Task>;

export function isComplete(task: Pick<Task, "completedAt">): boolean {
  return task.completedAt !== undefined;
}

export function isOverdue(task: Pick<Task, "dueAt" | "completedAt">, now: Date): boolean {
  return task.completedAt === undefined && task.dueAt < now;
}

export function complete(task: Task, at: Date, by: Ulid): Task {
  return { ...task, completedAt: at, completedBy: by, updatedAt: at };
}

/** Un-check a chore. Fingers slip, especially on a kiosk with gloves on. */
export function reopen(task: Task, at: Date): Task {
  const next = { ...task, updatedAt: at };
  delete (next as { completedAt?: Date }).completedAt;
  delete (next as { completedBy?: Ulid }).completedBy;
  return next;
}

/**
 * Does a template produce an instance on this date?
 *
 * Generation is pure and date-driven rather than a background job writing rows
 * ahead of time, so changing a template does not leave stale future instances
 * lying around.
 */
export function occursOn(
  template: Pick<ChoreTemplate, "recurrence" | "recurrenceDays" | "active">,
  date: Date,
): boolean {
  if (!template.active) return false;

  switch (template.recurrence) {
    case "once":
      return false;
    case "daily":
      return true;
    case "weekly":
      return template.recurrenceDays.includes(date.getDay());
    case "monthly":
      return template.recurrenceDays.includes(date.getDate());
    case "seasonal":
      return false;
  }
}

/** Dates in `[from, from + days)` on which a template fires. */
export function occurrencesInWindow(
  template: Pick<ChoreTemplate, "recurrence" | "recurrenceDays" | "active">,
  from: Date,
  days: number,
): Date[] {
  const dates: Date[] = [];
  for (let offset = 0; offset < days; offset++) {
    // Calendar days, not 24-hour steps: on the Sunday the clocks go back,
    // millisecond arithmetic lands twice on the same date and never reaches
    // the last one in the window.
    const date = addCalendarDays(from, offset);
    if (occursOn(template, date)) dates.push(date);
  }
  return dates;
}

/**
 * The day sheet (spec §6, "chores").
 *
 * One day's work, from two sources that have to read as one list: the chores
 * somebody wrote down, and the chores a template says are due. §4.5's derived
 * read model — nothing here is stored, so editing a template changes tomorrow's
 * sheet without leaving yesterday's rewritten.
 *
 * The rule that makes it usable is what it does *not* carry. A stored chore
 * that nobody ticked stays owed and moves forward day after day, because
 * somebody wrote it down and it still has not happened. A template occurrence
 * does not: "feed the flock" that went un-ticked on Tuesday is not still owed
 * on Wednesday — the flock was fed or it was not, and a list that stacks a
 * daily chore up seven deep by Sunday is a list people stop opening. Tuesday's
 * sheet still shows it missed; step back a day to see it.
 */

export interface ChoreEntry {
  /**
   * Stable across recomputation.
   *
   * The stored row's id once there is one, and a derived id before that, so
   * ticking a chore does not renumber the list under the finger that ticked it.
   */
  readonly id: string;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly dueAt: Date;
  readonly completedAt?: Date | undefined;
  readonly completedBy?: Ulid | undefined;
  readonly assignedTo?: Ulid | undefined;
  readonly zoneId?: Ulid | undefined;
  readonly animalId?: Ulid | undefined;
  /** The stored row. Absent on an occurrence nobody has touched yet. */
  readonly taskId?: Ulid | undefined;
  /** What generated it, if anything did. */
  readonly templateId?: Ulid | undefined;
  /** Written down on an earlier day and still not done. */
  readonly carriedOver: boolean;
  readonly overdue: boolean;
}

export interface ChoreDayInput {
  readonly tasks: readonly Task[];
  readonly templates: readonly ChoreTemplate[];
  /**
   * Derived entries from somewhere other than a template — today, feeding.
   *
   * Built by the caller because working them out needs names from three
   * entities and two modules, which §4.1 joins in the app. Merged here rather
   * than concatenated by the screen so there is one sort and one dedupe rule,
   * and so a feeding chore is late by the same arithmetic as every other one.
   */
  readonly derived?: readonly ChoreEntry[];
}

/** The derived id of an occurrence that has no stored row yet. */
export function occurrenceId(templateId: Ulid, date: Date): string {
  return `occurrence:${templateId}:${dayKey(date)}`;
}

/**
 * When a template's occurrence on `date` is due.
 *
 * The end of the day, unless the template names a part of it — then that
 * part's deadline, so the morning round turns overdue at eleven rather than
 * hiding among everything else until midnight. One function, used both by the
 * projection and by the write, so the sheet and the row it becomes agree.
 */
export function templateDueAt(template: Pick<ChoreTemplate, "timeOfDay">, date: Date): Date {
  return template.timeOfDay === undefined
    ? endOfDay(date)
    : timeOfDayDeadline(date, template.timeOfDay);
}

/**
 * The fields a template's occurrence becomes when it is written down.
 *
 * Called at the moment somebody ticks one, not by a job that writes rows ahead
 * of time. The store then holds the chores that actually happened rather than
 * a year of empty checkboxes.
 */
export function taskFromTemplate(
  template: ChoreTemplate,
  date: Date,
): Omit<Task, keyof BaseRecord> {
  return {
    templateId: template.id,
    title: template.title,
    detail: template.detail,
    dueAt: templateDueAt(template, date),
    zoneId: template.zoneId,
    animalId: template.animalId,
  };
}

function entryFromTask(task: Task, dayStart: Date, now: Date): ChoreEntry {
  return {
    id: task.id,
    title: task.title,
    detail: task.detail,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    completedBy: task.completedBy,
    assignedTo: task.assignedTo,
    zoneId: task.zoneId,
    animalId: task.animalId,
    taskId: task.id,
    templateId: task.templateId,
    carriedOver: task.dueAt < dayStart,
    overdue: isOverdue(task, now),
  };
}

/**
 * What is owed on `date`, ordered oldest first.
 *
 * `now` is separate from `date` on purpose: stepping back to yesterday must not
 * make yesterday's evening chores look like they are still in hand, and
 * stepping forward to tomorrow must not mark tomorrow's as late.
 */
export function choreDaySheet(input: ChoreDayInput, date: Date, now: Date): ChoreEntry[] {
  const dayStart = startOfDay(date);
  const key = dayKey(date);

  const onDay = input.tasks.filter((task) => dayKey(task.dueAt) === key);

  // Owed from before, and still not done. A completed one belongs to the day it
  // was due, not to every day after it.
  const owed = input.tasks.filter(
    (task) => task.dueAt < dayStart && task.completedAt === undefined,
  );

  // A template fires once per day, and the row it became is that day's answer.
  const materialised = new Set(
    onDay
      .filter((task) => task.templateId !== undefined)
      .map((task) => occurrenceId(task.templateId as Ulid, task.dueAt)),
  );

  // A derived occurrence somebody has ticked is a stored row now, matched by
  // the key that row kept. Without this the sheet shows the tick and the
  // untouched occurrence side by side, which reads as the chore coming back.
  const claimed = new Set(
    input.tasks.map((task) => task.sourceKey).filter((key): key is string => key !== undefined),
  );

  const derived = (input.derived ?? []).filter((entry) => !claimed.has(entry.id));

  const generated = input.templates
    .filter((template) => occursOn(template, date))
    .filter((template) => !materialised.has(occurrenceId(template.id, date)))
    .map((template): ChoreEntry => {
      const dueAt = templateDueAt(template, date);
      return {
        id: occurrenceId(template.id, date),
        title: template.title,
        detail: template.detail,
        dueAt,
        zoneId: template.zoneId,
        animalId: template.animalId,
        templateId: template.id,
        carriedOver: false,
        overdue: dueAt < now,
      };
    });

  return [...owed, ...onDay]
    .map((task) => entryFromTask(task, dayStart, now))
    .concat(generated, derived)
    .sort(
      (left, right) =>
        left.dueAt.getTime() - right.dueAt.getTime() ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    );
}

export interface ChoreProgress {
  readonly total: number;
  readonly done: number;
  readonly open: number;
  readonly overdue: number;
  /** `0` when there is nothing to do, which reads better than `NaN`. */
  readonly fraction: number;
}

/** The one-line version, for a dashboard tile or a kiosk header. */
export function choreProgress(entries: readonly ChoreEntry[]): ChoreProgress {
  const done = entries.filter((entry) => entry.completedAt !== undefined).length;

  return {
    total: entries.length,
    done,
    open: entries.length - done,
    overdue: entries.filter((entry) => entry.overdue).length,
    fraction: entries.length === 0 ? 0 : done / entries.length,
  };
}

/**
 * Chores on the unified calendar (spec §6).
 *
 * §6 lists chores among the calendar's projected rows, and they are the one
 * kind core contributes itself — `Task` and `ChoreTemplate` are declared in
 * this file, so nothing about this crosses a module boundary.
 *
 * Built by walking `choreDaySheet` a day at a time rather than by projecting
 * templates directly, so the calendar and the day sheet cannot disagree: a
 * template occurrence that has been ticked shows as the stored row on both,
 * and a template that fires on no day appears on neither.
 *
 * The dedupe is not defensive tidying. `choreDaySheet` deliberately carries an
 * un-ticked written-down chore forward on to every day after its due date,
 * which is right for a day sheet and wrong for a calendar — a fortnight-old
 * chore would otherwise paint itself across the whole month. Keeping the first
 * sighting puts it back on the day it was actually due.
 */
export function choreCalendarEntries(
  input: ChoreDayInput,
  from: Date,
  days: number,
  now: Date,
): CalendarEntry[] {
  const seen = new Map<string, CalendarEntry>();

  for (let offset = 0; offset < days; offset++) {
    const date = addCalendarDays(from, offset);

    for (const entry of choreDaySheet(input, date, now)) {
      const id =
        entry.taskId === undefined
          ? `${projectedId("chore", "choreTemplates", entry.templateId as Ulid)}:${dayKey(entry.dueAt)}`
          : projectedId("chore", "tasks", entry.taskId);
      if (seen.has(id)) continue;

      seen.set(id, {
        id,
        kind: "chore",
        module: "chores",
        title: entry.title,
        detail: entry.detail,
        at: entry.dueAt,
        // A chore is due *by* a moment, not *at* one — the end of its day,
        // or its part of the day's deadline. Rendering it at 11:59pm would
        // file the evening round under bedtime, so it stays all-day.
        allDay: true,
        source:
          entry.taskId === undefined
            ? { entity: "choreTemplates", id: entry.templateId as Ulid }
            : { entity: "tasks", id: entry.taskId },
      });
    }
  }

  return [...seen.values()];
}
