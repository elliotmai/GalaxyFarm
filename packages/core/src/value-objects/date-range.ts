import { z } from "zod";

/**
 * A half-open interval `[from, to)` with an optional open end.
 *
 * An open end is the normal case here, not an edge case: the current
 * ZoneAssignment is the one with no `to`, and a boarding agreement runs until
 * the calf goes home. Modelling "still true" as `undefined` rather than a
 * sentinel date keeps that honest.
 */

export interface DateRange {
  readonly from: Date;
  readonly to?: Date | undefined;
}

export const dateRangeSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date().optional(),
  })
  .refine((range) => range.to === undefined || range.to >= range.from, {
    message: "A range cannot end before it starts",
    path: ["to"],
  });

export function dateRange(from: Date, to?: Date): DateRange {
  if (to !== undefined && to < from) {
    throw new RangeError("A range cannot end before it starts");
  }
  return to === undefined ? { from } : { from, to };
}

export function isOpenRange(range: DateRange): boolean {
  return range.to === undefined;
}

/** Half-open: the start is inside, the end is not. */
export function contains(range: DateRange, at: Date): boolean {
  if (at < range.from) return false;
  return range.to === undefined || at < range.to;
}

export function overlaps(left: DateRange, right: DateRange): boolean {
  const leftEndsBefore = left.to !== undefined && left.to <= right.from;
  const rightEndsBefore = right.to !== undefined && right.to <= left.from;
  return !leftEndsBefore && !rightEndsBefore;
}

/**
 * A `Date`, whatever shape it arrived in.
 *
 * Every date in this app is a `Date` by the time a screen sees it — the sync
 * transport revives them and the schemas coerce them. "Every" was not quite
 * true: timestamps inside a JSON column (a hair card's `testedOn`, a
 * breeding's `pregCheck.date`) came off the wire as strings, and a screen
 * calling `toLocaleDateString` on one threw where it stood. React unmounts the
 * tree on a render that throws, so a single stale hair card put "Application
 * error: a client-side exception has occurred" over the whole app.
 *
 * The reviving is fixed and devices re-read what they hold, but a record
 * written by an older build is still on somebody's phone. This is what the
 * screens that print those fields use, so the worst such a record can do is
 * show no date.
 */
export function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string" && typeof value !== "number") return undefined;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export const MS_PER_DAY = 86_400_000;

/** Whole days covered, using `now` for an open range. */
export function durationDays(range: DateRange, now: Date): number {
  const end = range.to ?? now;
  return Math.floor((end.getTime() - range.from.getTime()) / MS_PER_DAY);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Step by a calendar day rather than by twenty-four hours.
 *
 * `addDays` adds milliseconds, which is what gestation and withdrawal
 * arithmetic want. Walking a calendar is a different question: on the Sunday
 * the clocks go back, local midnight plus 86,400,000 ms is 11pm *the same
 * evening*, so a loop over "the next seven days" visits that day twice and
 * never reaches the seventh. Twice a year the chore list would be wrong, which
 * is the kind of bug that gets blamed on the person who ticked it.
 */
export function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Local midnight, and the instant before the next one.
 *
 * Local, deliberately. A chore due "today" is due on the day the person
 * standing in the barn is having, and a UTC day boundary puts every evening
 * chore on tomorrow's list for six hours — which on this farm is exactly the
 * hours the evening chores happen in.
 *
 * `endOfDay` is the last millisecond rather than the next midnight, so a due
 * time built from it compares as inside the day under `<=` and outside it
 * under `<` — the half-open convention `DateRange` uses everywhere else.
 */
export function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function isSameDay(left: Date, right: Date): boolean {
  return dayKey(left) === dayKey(right);
}

/**
 * `YYYY-MM-DD` in local time.
 *
 * The key everything that groups by day agrees on. `toISOString().slice(0, 10)`
 * is the tempting one-liner and it is wrong for the same reason as above: it
 * answers in UTC, so an 8pm chore in Texas files itself under tomorrow.
 */
export function dayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Close an open range. Closing an already-closed one is a bug, not a no-op. */
export function close(range: DateRange, at: Date): DateRange {
  if (range.to !== undefined) {
    throw new Error("Range is already closed");
  }
  return dateRange(range.from, at);
}
