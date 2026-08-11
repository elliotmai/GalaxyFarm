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

export const MS_PER_DAY = 86_400_000;

/** Whole days covered, using `now` for an open range. */
export function durationDays(range: DateRange, now: Date): number {
  const end = range.to ?? now;
  return Math.floor((end.getTime() - range.from.getTime()) / MS_PER_DAY);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
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
