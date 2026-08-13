import { z } from "zod";

import { baseRecordSchema, ulidSchema, type BaseRecord, type Ulid } from "@galaxy-farm/core";

/**
 * Durable tracking (spec §5.11).
 *
 * "Count (24 panels), condition, optional assignment to a zone or animal
 * (which show halter lives with which calf), and a retired/lost/damaged log."
 *
 * An assignment log rather than a field on the item, for the same reason
 * `ZoneAssignment` is a log: "which halter was on that calf at the show" is a
 * question about the past, and a field only ever answers about now.
 */

export const DURABLE_CONDITIONS = ["new", "good", "worn", "damaged", "retired", "lost"] as const;
export type DurableCondition = (typeof DURABLE_CONDITIONS)[number];

export interface DurableAssignment extends BaseRecord {
  readonly supplyItemId: Ulid;
  readonly quantity: number;
  readonly animalId?: Ulid | undefined;
  readonly zoneId?: Ulid | undefined;
  readonly condition: DurableCondition;
  /**
   * Named the way `ZoneAssignment` names its period, and for a reason beyond
   * symmetry: a bare `from` is not recognisable as a timestamp by name, and
   * the sync client has to go by name — it runs in the browser and cannot ask
   * the schema. An unrecognised timestamp arrives as a string and every
   * comparison against it is NaN, which here would mean a halter quietly
   * never being out with anybody.
   */
  readonly periodFrom: Date;
  readonly periodTo?: Date | undefined;
  readonly notes?: string | undefined;
}

export const durableAssignmentSchema = baseRecordSchema
  .extend({
    supplyItemId: ulidSchema,
    quantity: z.number().int().positive(),
    animalId: ulidSchema.optional(),
    zoneId: ulidSchema.optional(),
    condition: z.enum(DURABLE_CONDITIONS),
    periodFrom: z.coerce.date(),
    periodTo: z.coerce.date().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (assignment) =>
      assignment.periodTo === undefined || assignment.periodTo >= assignment.periodFrom,
    { message: "An assignment cannot end before it starts", path: ["periodTo"] },
  )
  .refine(
    (assignment) =>
      assignment.condition !== "retired" && assignment.condition !== "lost"
        ? true
        : assignment.periodTo !== undefined,
    // Retiring something without closing the assignment leaves a retired halter
    // still showing as being on a calf.
    { message: "Close the assignment when something is retired or lost", path: ["periodTo"] },
  ) as unknown as z.ZodType<DurableAssignment>;

/** Open assignments — where things are right now. */
export function currentlyAssigned(
  assignments: readonly DurableAssignment[],
  at: Date,
): DurableAssignment[] {
  return assignments.filter(
    (assignment) =>
      assignment.periodFrom <= at &&
      (assignment.periodTo === undefined || assignment.periodTo > at),
  );
}

/** What is with one animal today — the show-halter question. */
export function assignedTo(
  assignments: readonly DurableAssignment[],
  animalId: Ulid,
  at: Date,
): DurableAssignment[] {
  return currentlyAssigned(assignments, at).filter(
    (assignment) => assignment.animalId === animalId,
  );
}

/**
 * How many of an item are still in service.
 *
 * Retired and lost come off the count. Twenty-four panels with two bent into
 * scrap is twenty-two panels, and a pen laid out against twenty-four is a pen
 * that will not close.
 */
export function inService(
  supplyItemId: Ulid,
  total: number,
  assignments: readonly DurableAssignment[],
): number {
  const goneCount = assignments
    .filter((assignment) => assignment.supplyItemId === supplyItemId)
    .filter((assignment) => assignment.condition === "retired" || assignment.condition === "lost")
    .reduce((total_, assignment) => total_ + assignment.quantity, 0);

  return total - goneCount;
}
