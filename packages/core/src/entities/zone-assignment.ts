import { z } from "zod";

import { dateRange, isOpenRange, type DateRange } from "../value-objects/date-range.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * Where an animal is, and where it has been (spec §5.1).
 *
 * Current location is the open assignment; history is free because nothing is
 * ever overwritten. Moving an animal closes one assignment and opens another,
 * which is why the Pen Board can show you where a cow was in March.
 *
 * The period is **two flat fields, not a nested range**, and that is a sync
 * decision (§4.2). Patches carry fields: closing an assignment is one field
 * changing, `periodTo`, and it merges against another device's edit
 * independently of when the assignment started. Nested, the whole range would
 * be one field, and two devices — one moving the animal, one correcting the
 * start date — would clobber each other for no reason. It also keeps both
 * values as real timestamp columns rather than strings inside JSON, which is
 * what "the open assignment" is queried on.
 *
 * `periodOf` builds the value object where the domain wants one.
 */

/** Client calves hold two concurrent assignments — inside and outside (§5.1). */
export const ASSIGNMENT_SLOTS = ["primary", "inside", "outside"] as const;
export type AssignmentSlot = (typeof ASSIGNMENT_SLOTS)[number];

export interface ZoneAssignment extends BaseRecord {
  readonly animalId: Ulid;
  readonly zoneId: Ulid;
  readonly periodFrom: Date;
  /** Absent while the animal is still there. */
  readonly periodTo?: Date | undefined;
  readonly slot: AssignmentSlot;
}

export const zoneAssignmentSchema = baseRecordSchema
  .extend({
    animalId: ulidSchema,
    zoneId: ulidSchema,
    periodFrom: z.coerce.date(),
    periodTo: z.coerce.date().optional(),
    slot: z.enum(ASSIGNMENT_SLOTS),
  })
  .refine((a) => a.periodTo === undefined || a.periodTo >= a.periodFrom, {
    message: "An assignment cannot end before it starts",
    path: ["periodTo"],
  }) as unknown as z.ZodType<ZoneAssignment>;

/** The stored fields as the domain's range value object. */
export function periodOf(assignment: Pick<ZoneAssignment, "periodFrom" | "periodTo">): DateRange {
  return dateRange(assignment.periodFrom, assignment.periodTo);
}

export function isCurrent(assignment: Pick<ZoneAssignment, "periodFrom" | "periodTo">): boolean {
  return isOpenRange(periodOf(assignment));
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
  next: Omit<ZoneAssignment, "periodFrom" | "periodTo"> & { readonly at: Date },
): { readonly closed?: ZoneAssignment; readonly opened: ZoneAssignment } {
  const { at, ...rest } = next;
  const opened: ZoneAssignment = { ...rest, periodFrom: at };

  if (from === undefined) return { opened };
  return {
    closed: { ...from, periodTo: at, updatedAt: at },
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
    .filter((a) => a.periodFrom <= at && (a.periodTo === undefined || at < a.periodTo))
    .map((a) => a.animalId);
}
