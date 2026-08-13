import {
  addCalendarDays,
  isSameDay,
  taskFromTemplate,
  type ChoreEntry,
  type ChoreTemplate,
  type CrudError,
  type Recurrence,
  type Result,
  type Task,
  type Ulid,
} from "@galaxy-farm/core";

import type { Mutations } from "@/lib/local/mutations";

/**
 * Chores, either side of the domain (spec §6, §12).
 *
 * Ticking one off lives here rather than in a screen because two surfaces do
 * it — the chores page and the dashboard card — and §12 asks for every
 * frequent action to be within two taps of wherever you already are. Two
 * copies of it would be two chances to write the un-tick wrongly, and the
 * un-tick is the subtle half.
 *
 * The recurrence readers below are here for the plainer reason that they are
 * logic rather than markup: what somebody typed into a box, and what a stored
 * rule means in a sentence.
 */

/**
 * "Today", "Yesterday", or the day named in full.
 *
 * The three near days get words because that is what somebody stepping back
 * one screen is looking for; anything further away gets its name, because
 * "three days ago" is a sum and a date is not.
 */
export function dayLabel(date: Date, today: Date): string {
  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, addCalendarDays(today, -1))) return "Yesterday";
  if (isSameDay(date, addCalendarDays(today, 1))) return "Tomorrow";

  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The recurrences that actually put something on a day sheet today. */
export const GENERATING_RECURRENCES: readonly Recurrence[] = ["daily", "weekly", "monthly"];

/**
 * "1, 15" → `[1, 15]`.
 *
 * Keeps only the days a month can have, drops duplicates, and sorts — so a
 * box typed into in a hurry becomes a rule rather than a validation error.
 */
export function parseMonthDays(input: string): number[] {
  const days = input
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31);

  return [...new Set(days)].sort((left, right) => left - right);
}

/**
 * What a template's rule means, in one line.
 *
 * A rule that fires on nothing says so. Weekly with no weekday ticked and
 * monthly with no day typed both validate — the schema has no opinion on an
 * empty array — and both then sit in the list producing nothing at all, which
 * reads as the feature being broken rather than the rule being unfinished.
 */
export function describeRecurrence(
  template: Pick<ChoreTemplate, "recurrence" | "recurrenceDays">,
): string {
  switch (template.recurrence) {
    case "daily":
      return "Every day";
    case "weekly":
      return template.recurrenceDays.length === 0
        ? "Weekly — no day chosen, so it never fires"
        : `Every ${template.recurrenceDays.map((day) => WEEKDAY_NAMES[day] ?? "?").join(", ")}`;
    case "monthly":
      return template.recurrenceDays.length === 0
        ? "Monthly — no day chosen, so it never fires"
        : `On the ${template.recurrenceDays.join(", ")} of each month`;
    case "once":
      return "One-off — add it on the day instead";
    case "seasonal":
      return "Seasonal — not generated yet";
  }
}

export interface ChoreToggleInput {
  readonly entry: ChoreEntry;
  /** Needed only when the entry has no stored row yet. */
  readonly template?: ChoreTemplate | undefined;
  /** The day being shown, which is not always today. */
  readonly date: Date;
  readonly at: Date;
  readonly actorId: Ulid;
}

/**
 * Finish a chore, or put it back.
 *
 * Three cases, and the first is the one that matters. An entry with no row
 * behind it is an occurrence a template projected: finishing it writes the row
 * *already complete*, rather than writing an empty one and immediately
 * updating it. One patch instead of two — which is one thing to carry out of a
 * barn on one bar of signal, and no window in which a crash leaves a chore
 * that exists but was never done.
 *
 * Un-ticking names the fields explicitly. A patch carries the fields that
 * changed, and a key that is merely absent is not a change: dropping them
 * would leave the chore reading as done on every other device on the farm.
 */
export async function toggleChore(
  tasks: Mutations<Task>,
  { entry, template, date, at, actorId }: ChoreToggleInput,
): Promise<Result<Task, CrudError>> {
  if (entry.taskId === undefined) {
    if (template === undefined) {
      return {
        ok: false,
        error: {
          kind: "not-found",
          entity: "choreTemplates",
          id: (entry.templateId ?? entry.id) as Ulid,
        },
      };
    }

    return tasks.create({
      ...taskFromTemplate(template, date),
      completedAt: at,
      completedBy: actorId,
    });
  }

  return tasks.update(
    entry.taskId,
    entry.completedAt === undefined
      ? { completedAt: at, completedBy: actorId }
      : { completedAt: undefined, completedBy: undefined },
  );
}
