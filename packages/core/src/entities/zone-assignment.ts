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

/**
 * An animal stands in at most two places at once (§5.1).
 *
 * One outside — a trap, a pasture, a lot — and one inside, a stall or a barn
 * pen. That is not a limitation, it is what is physically true, and the app
 * has to hold it or the Pen Board starts listing the same cow in three places
 * and stops being worth walking out with.
 *
 * `primary` is legacy. It is what every assignment was before the slots were
 * used, and it stays in the union because rows on devices still carry it.
 * Nothing writes it any more — `slotForZone` decides from the zone — and
 * `effectiveSlot` reads an old row as whichever slot its zone implies, so no
 * migration is needed and no cow is in two outside pens because one of the
 * rows predates the rule.
 */
export const ASSIGNMENT_SLOTS = ["primary", "inside", "outside"] as const;
export type AssignmentSlot = (typeof ASSIGNMENT_SLOTS)[number];

/**
 * Which slot a zone occupies, derived rather than asked for.
 *
 * §2: derive, don't duplicate. The zone already knows whether it is indoor;
 * asking somebody to also pick "inside" or "outside" when moving a cow into
 * the barn is asking them to restate a fact the app has, and to be wrong
 * occasionally.
 */
export function slotForZone(zone: { readonly indoor: boolean }): AssignmentSlot {
  return zone.indoor ? "inside" : "outside";
}

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

/** Where an animal is standing right now — at most one inside, one outside. */
export function openAssignments(
  assignments: readonly ZoneAssignment[],
  animalId: Ulid,
): ZoneAssignment[] {
  return assignments.filter((a) => a.animalId === animalId && isCurrent(a));
}

/**
 * The slot an assignment really occupies.
 *
 * Read from the zone rather than from the stored value, so a legacy `primary`
 * row counts against the slot its zone implies. Without this, an animal with
 * an old `primary` row in a trap could be moved into a second trap and the
 * rule would not notice — the two rows have different slot strings and the
 * cow is in two pastures.
 *
 * An unknown zone falls back to the stored slot. A zone that has been deleted
 * out from under an assignment is a different problem, and guessing "outside"
 * would silently close somebody's barn assignment.
 */
export function effectiveSlot(
  assignment: Pick<ZoneAssignment, "zoneId" | "slot">,
  indoorZoneIds: ReadonlySet<Ulid>,
): AssignmentSlot {
  if (indoorZoneIds.has(assignment.zoneId)) return "inside";
  return assignment.slot === "primary" ? "outside" : assignment.slot;
}

/**
 * The open assignments a move into `slot` has to close first.
 *
 * Plural, and that is the point. One is the ordinary case; more than one means
 * the rule has already been broken — by an older build, by a sync that landed
 * a create whose matching close was rejected, by two devices moving the same
 * cow at once. Closing all of them repairs the record rather than leaving a
 * cow listed in two pastures forever with no way to say which is wrong.
 */
export function conflictingAssignments(
  assignments: readonly ZoneAssignment[],
  animalId: Ulid,
  slot: AssignmentSlot,
  indoorZoneIds: ReadonlySet<Ulid>,
): ZoneAssignment[] {
  return openAssignments(assignments, animalId).filter(
    (a) => effectiveSlot(a, indoorZoneIds) === slot,
  );
}

/**
 * Animals with more than one open assignment in the same slot.
 *
 * For a check that can be run over the whole herd — a cow in two pastures is
 * invisible on any one screen and obvious across all of them.
 *
 * Counts **rows, not distinct zones**, and that distinction is the whole of a
 * bug this missed. It used to collect the zone ids into a set and complain when
 * the set held more than one, which silently excused the commonest corruption
 * of the two: the same animal open twice *in the same zone*. One zone, set of
 * size one, no complaint — while the record said she was in the North Trap
 * twice over. The check written for this class of fault was blind to the shape
 * it actually took in the field.
 */
export function doubleBookedAnimals(
  assignments: readonly ZoneAssignment[],
  indoorZoneIds: ReadonlySet<Ulid>,
): Ulid[] {
  const perSlot = new Map<string, number>();

  for (const assignment of assignments.filter(isCurrent)) {
    const key = `${assignment.animalId}:${effectiveSlot(assignment, indoorZoneIds)}`;
    perSlot.set(key, (perSlot.get(key) ?? 0) + 1);
  }

  const doubled = new Set<Ulid>();
  for (const [key, count] of perSlot) {
    if (count > 1) doubled.add(key.split(":")[0] as Ulid);
  }
  return [...doubled];
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

export interface ZoneMove {
  /** Assignments to close. Persist these before the new one. */
  readonly closed: ZoneAssignment[];
  /**
   * The assignment to create — absent when she is already there.
   *
   * Undefined rather than a no-op record, so a caller cannot write it by
   * accident. A move that does not need to happen must produce no row at all.
   */
  readonly opened?: ZoneAssignment | undefined;
  /**
   * She was already standing in this zone for this slot.
   *
   * Worth reporting rather than swallowing: somebody pressed a button, and
   * "she is already in the North Trap" and "moved to the North Trap" are
   * different answers to it.
   */
  readonly alreadyThere: boolean;
}

/**
 * Move an animal into a zone, closing whatever it was in for that slot.
 *
 * The slot comes from the zone, so moving a cow into the barn leaves her
 * pasture assignment open and moving her to another trap closes the first one.
 * That is the rule stated once, in the one place both the herd screen and the
 * pen board go through.
 *
 * ## Moving her where she already is
 *
 * Reported from the field: a cow set to her own zone ended up assigned to it
 * twice — two open rows, same animal, same zone, same slot, which no screen can
 * render honestly and which every count downstream reads as two animals'-worth
 * of one animal.
 *
 * The old code was half right. It refused to close her existing row, correctly,
 * because closing and reopening the same zone writes a zero-length period into
 * the history for no reason — and then opened the new row anyway, which does
 * not follow from that at all. If she is already there, the whole move is a
 * no-op: nothing closes and nothing opens.
 *
 * It is reachable from every screen that moves an animal, because picking her
 * current pen out of a list of pens is an ordinary thing to do.
 */
export function moveToZone(
  assignments: readonly ZoneAssignment[],
  next: Omit<ZoneAssignment, "periodFrom" | "periodTo" | "slot"> & {
    readonly at: Date;
    readonly indoor: boolean;
  },
  indoorZoneIds: ReadonlySet<Ulid>,
): ZoneMove {
  const { at, indoor, ...rest } = next;
  const slot = slotForZone({ indoor });

  const open = conflictingAssignments(assignments, rest.animalId, slot, indoorZoneIds);
  const here = open.filter((a) => a.zoneId === rest.zoneId);
  const elsewhere = open.filter((a) => a.zoneId !== rest.zoneId);

  if (here.length > 0) {
    // Already there, so no new row. Any *extra* rows for the same zone are
    // still repaired: the oldest keeps the true date she arrived and the rest
    // are closed, because more than one open row for one place is exactly the
    // fault this is here for.
    const duplicates = [...here]
      .sort((left, right) => left.periodFrom.getTime() - right.periodFrom.getTime())
      .slice(1);

    return {
      closed: [...duplicates, ...elsewhere].map((a) => ({ ...a, periodTo: at, updatedAt: at })),
      alreadyThere: true,
    };
  }

  return {
    closed: elsewhere.map((a) => ({ ...a, periodTo: at, updatedAt: at })),
    opened: { ...rest, slot, periodFrom: at },
    alreadyThere: false,
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
