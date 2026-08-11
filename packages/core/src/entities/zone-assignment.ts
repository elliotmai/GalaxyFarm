import { z } from "zod";

import { close, dateRange, isOpenRange, type DateRange } from "../value-objects/date-range.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * Where an animal is, and where it has been (spec §5.1).
 *
 * Current location is the open assignment; history is free because nothing is
 * ever overwritten. Moving an animal closes one assignment and opens another,
 * which is why the Pen Board can show you where a cow was in March.
 */

/** Client calves hold two concurrent assignments — inside and outside (§5.1). */
export const ASSIGNMENT_SLOTS = ["primary", "inside", "outside"] as const;
export type AssignmentSlot = (typeof ASSIGNMENT_SLOTS)[number];

export interface ZoneAssignment extends BaseRecord {
  readonly animalId: Ulid;
  readonly zoneId: Ulid;
  readonly period: DateRange;
  readonly slot: AssignmentSlot;
}

export const zoneAssignmentSchema = baseRecordSchema.extend({
  animalId: ulidSchema,
  zoneId: ulidSchema,
  period: z
    .object({ from: z.coerce.date(), to: z.coerce.date().optional() })
    .refine((period) => period.to === undefined || period.to >= period.from, {
      message: "An assignment cannot end before it starts",
      path: ["to"],
    }),
  slot: z.enum(ASSIGNMENT_SLOTS),
}) as unknown as z.ZodType<ZoneAssignment>;

export function isCurrent(assignment: Pick<ZoneAssignment, "period">): boolean {
  return isOpenRange(assignment.period);
}

/** The open assignment for a slot, if the animal has one. */
export function currentAssignment(
  assignments: readonly ZoneAssignment[],
  slot: AssignmentSlot = "primary",
): ZoneAssignment | undefined {
  return assignments.find((a) => a.slot === slot && isCurrent(a));
}

/**
 * Move an animal: close the open assignment, open a new one.
 *
 * Returns both records because the caller has to persist both, and because
 * doing it in one place is what stops history being silently overwritten by a
 * well-meaning `update`.
 */
export function move(
  from: ZoneAssignment | undefined,
  next: Omit<ZoneAssignment, "period"> & { readonly at: Date },
): { readonly closed?: ZoneAssignment; readonly opened: ZoneAssignment } {
  const { at, ...rest } = next;
  const opened: ZoneAssignment = { ...rest, period: dateRange(at) };

  if (from === undefined) return { opened };
  return {
    closed: { ...from, period: close(from.period, at), updatedAt: at },
    opened,
  };
}

/** Occupants of a zone at a moment — the Pen Board's core query. */
export function occupantsOf(
  assignments: readonly ZoneAssignment[],
  zoneId: Ulid,
  at: Date,
): Ulid[] {
  return assignments
    .filter((a) => a.zoneId === zoneId)
    .filter((a) => a.period.from <= at && (a.period.to === undefined || at < a.period.to))
    .map((a) => a.animalId);
}
