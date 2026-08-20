import { z } from "zod";

import {
  addDays,
  baseRecordSchema,
  MS_PER_DAY,
  ulidSchema,
  type BaseRecord,
  type DateRange,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * Breeding, and the dates that fall out of it (spec §5.2).
 *
 * This is the one place in the app where a wrong number has a deadline
 * attached. Andromeda was bred on 14 February 2026; at the spec's flat 283-day
 * gestation that is 24 November, and the watch opens on the 10th. Everything
 * downstream — the calving window on the calendar, the watch card on the
 * dashboard, the weather correlation in §6 — is derived from `date` and the
 * gestation setting, so those two are the only things anybody has to type.
 */

export const BREEDING_METHODS = ["AI", "natural", "ET"] as const;
export type BreedingMethod = (typeof BREEDING_METHODS)[number];

export const PREG_CHECK_METHODS = ["palpation", "ultrasound", "blood", "visual"] as const;
export type PregCheckMethod = (typeof PREG_CHECK_METHODS)[number];

export const PREG_CHECK_RESULTS = ["open", "bred", "recheck"] as const;
export type PregCheckResult = (typeof PREG_CHECK_RESULTS)[number];

/**
 * §12 decision 2: a flat 283 days for every breed, editable in settings.
 *
 * No Chi-influence adjustment — that was considered and rejected. The number
 * lives here rather than being written into each call site so changing it in
 * settings changes every projection at once.
 */
export const DEFAULT_GESTATION_DAYS = 283;

/** §6: the watch opens a fortnight before the due date and closes a fortnight after. */
export const DEFAULT_CALVING_WINDOW_DAYS = 14;

/**
 * The outside edges of a gestation, for a record and for a guess.
 *
 * These bound what somebody may type as an override, and they bound how far
 * from a breeding a calving can be and still be *that* breeding's calving. A
 * cow carrying 239 days did not carry to the service 239 days ago, and one at
 * 321 days is either not hers or is a date somebody mistyped.
 */
export const MIN_GESTATION_DAYS = 240;
export const MAX_GESTATION_DAYS = 320;

export interface PregCheck {
  readonly date: Date;
  readonly result: PregCheckResult;
  readonly method: PregCheckMethod;
  readonly notes?: string | undefined;
}

export interface BreedingRecord extends BaseRecord {
  readonly damId: Ulid;
  readonly method: BreedingMethod;
  /** The bull himself: a natural service, or the bull a straw was collected from. */
  readonly bullId?: Ulid | undefined;
  /** The straw drawn, for `AI`. Decrements semen inventory. */
  readonly semenInventoryId?: Ulid | undefined;
  /** Sire as an ExternalAnimal, when the semen is not from stock we track. */
  readonly sireExternalId?: Ulid | undefined;
  /**
   * The sire as he was written down, when nothing on file is him.
   *
   * A straw bought and thawed the same morning, or a breeding done at somebody
   * else's place and phoned in: the bull has a name and the farm has no record
   * of him, no straw of him, and no reason to invent an ancestor for him. The
   * name is what the calf's papers will be filled in from, so it is worth more
   * than the breeding going unrecorded because there was no row to point at.
   */
  readonly sireName?: string | undefined;
  /** Donor dam and embryo identifier, for `ET`. */
  readonly embryoDonorId?: Ulid | undefined;
  readonly embryoCode?: string | undefined;
  readonly date: Date;
  /** Contact — the AI technician or vet who bred her. */
  readonly technicianId?: Ulid | undefined;
  readonly syncProtocolId?: Ulid | undefined;
  readonly pregCheck?: PregCheck | undefined;
  /** Overrides the property default; §12 decision 2 makes it configurable. */
  readonly gestationDays?: number | undefined;
  readonly notes?: string | undefined;
}

/**
 * Is the sire answered for?
 *
 * Four ways to say who the bull was, and any one of them is enough: the straw
 * drawn from the tank, a bull standing here, an ancestor already on file, or
 * his name typed in.
 *
 * The name counts deliberately. Requiring a straw or a record on file made the
 * commonest AI on this farm unrecordable — semen the farm never held, in a
 * chute that was not ours — and a breeding that cannot be entered is not a
 * cleaner pedigree, it is a due date nobody is watching. A name is thinner
 * than a reference and it is what the papers are filled in from; the record
 * can be pointed at a real ancestor later without losing the date.
 */
export function namesASire(
  record: Pick<BreedingRecord, "bullId" | "semenInventoryId" | "sireExternalId" | "sireName">,
): boolean {
  return (
    record.bullId !== undefined ||
    record.semenInventoryId !== undefined ||
    record.sireExternalId !== undefined ||
    (record.sireName !== undefined && record.sireName.trim() !== "")
  );
}

export const pregCheckSchema = z.object({
  date: z.coerce.date(),
  result: z.enum(PREG_CHECK_RESULTS),
  method: z.enum(PREG_CHECK_METHODS),
  notes: z.string().max(2000).optional(),
});

export const breedingRecordSchema = baseRecordSchema
  .extend({
    damId: ulidSchema,
    method: z.enum(BREEDING_METHODS),
    bullId: ulidSchema.optional(),
    semenInventoryId: ulidSchema.optional(),
    sireExternalId: ulidSchema.optional(),
    sireName: z.string().min(1, "Name the sire, or leave it out").max(160).optional(),
    embryoDonorId: ulidSchema.optional(),
    embryoCode: z.string().max(80).optional(),
    date: z.coerce.date(),
    technicianId: ulidSchema.optional(),
    syncProtocolId: ulidSchema.optional(),
    pregCheck: pregCheckSchema.optional(),
    gestationDays: z.number().int().min(MIN_GESTATION_DAYS).max(MAX_GESTATION_DAYS).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((record) => record.method !== "natural" || namesASire(record), {
    message: "A natural service needs the bull — pick him, or type his name",
    path: ["bullId"],
  })
  .refine((record) => record.method !== "AI" || namesASire(record), {
    message: "An AI breeding needs the sire — a straw, a bull on file, or his name",
    path: ["semenInventoryId"],
  })
  .refine((record) => record.pregCheck === undefined || record.pregCheck.date >= record.date, {
    message: "A pregnancy check cannot predate the breeding",
    path: ["pregCheck", "date"],
  }) as unknown as z.ZodType<BreedingRecord>;

/** When she is due. */
export function projectedDueDate(
  record: Pick<BreedingRecord, "date" | "gestationDays">,
  defaultGestationDays: number = DEFAULT_GESTATION_DAYS,
): Date {
  return addDays(record.date, record.gestationDays ?? defaultGestationDays);
}

/**
 * The fortnight either side of the due date.
 *
 * Half-open at the far end, like every other range in the kernel, so a cow
 * calving exactly on the closing day is still inside her window that morning.
 */
export function calvingWindow(
  record: Pick<BreedingRecord, "date" | "gestationDays">,
  options: { defaultGestationDays?: number; windowDays?: number } = {},
): DateRange {
  const due = projectedDueDate(record, options.defaultGestationDays ?? DEFAULT_GESTATION_DAYS);
  const spread = options.windowDays ?? DEFAULT_CALVING_WINDOW_DAYS;
  return { from: addDays(due, -spread), to: addDays(due, spread + 1) };
}

/**
 * Is she being watched right now?
 *
 * A confirmed-open check ends the watch: a cow that came back open is not
 * about to calve, and leaving her on the dashboard for a month teaches people
 * to ignore the card.
 */
export function isInCalvingWindow(
  record: Pick<BreedingRecord, "date" | "gestationDays" | "pregCheck">,
  now: Date,
  options: { defaultGestationDays?: number; windowDays?: number } = {},
): boolean {
  if (record.pregCheck?.result === "open") return false;
  const window = calvingWindow(record, options);
  return now >= window.from && now < (window.to as Date);
}

/**
 * Days along she is, which is how a calving-watch alert says it out loud.
 *
 * Floored rather than rounded. A cow is "at day 279" for the whole of day 279,
 * not from lunchtime onwards — `daysBetween` rounds, which would have her at
 * day 280 by early afternoon and report two different numbers for one evening.
 */
export function daysBred(record: Pick<BreedingRecord, "date">, now: Date): number {
  return Math.floor((now.getTime() - record.date.getTime()) / MS_PER_DAY);
}

/**
 * When to check her.
 *
 * Thirty days for blood, thirty-five for ultrasound, forty-five for palpation —
 * the earliest each method is reliable. Checking too early reads open on a
 * bred cow, which is the expensive direction of the mistake: she gets sold or
 * re-bred.
 */
export const PREG_CHECK_EARLIEST_DAYS: Readonly<Record<PregCheckMethod, number>> = {
  blood: 30,
  ultrasound: 35,
  palpation: 45,
  visual: 150,
};

export function pregCheckDue(
  record: Pick<BreedingRecord, "date" | "pregCheck">,
  method: PregCheckMethod = "ultrasound",
): Date | undefined {
  if (record.pregCheck !== undefined && record.pregCheck.result !== "recheck") return undefined;
  return addDays(record.date, PREG_CHECK_EARLIEST_DAYS[method]);
}

/**
 * A calving, as this file needs to see one.
 *
 * Structural rather than the real `CalvingRecord`, so breeding does not import
 * calving and calving does not import breeding. `damsThatHaveCalved` in
 * `cattle-class.ts` takes the same shape for the same reason.
 */
export interface CalvingLike {
  readonly damId: Ulid;
  readonly breedingRecordId?: Ulid | undefined;
  readonly date: Date;
}

/**
 * The calving that answers a breeding.
 *
 * The link is `breedingRecordId`, written by the calving flow, and that is
 * what is trusted first. The fallback exists for the calvings that carry none
 * — recorded before the flow set it, or entered on a device that never saw the
 * breeding — and it is deliberately narrow: the same cow, a calving after the
 * service, and inside the outside edges of a real gestation. A calving 200
 * days after a service is not that service's calf, and guessing that it is
 * would close out a breeding the cow is still carrying.
 *
 * Only unlinked calvings are matched that way. One that names a *different*
 * breeding has already been answered for, and stealing it here would show two
 * services both claiming one calf.
 */
export function calvingFor<T extends CalvingLike>(
  calvings: readonly T[],
  breeding: Pick<BreedingRecord, "id" | "damId" | "date">,
): T | undefined {
  const linked = calvings.find((record) => record.breedingRecordId === breeding.id);
  if (linked !== undefined) return linked;

  const earliest = addDays(breeding.date, MIN_GESTATION_DAYS);
  const latest = addDays(breeding.date, MAX_GESTATION_DAYS);

  return calvings
    .filter(
      (record) =>
        record.breedingRecordId === undefined &&
        record.damId === breeding.damId &&
        record.date >= earliest &&
        record.date <= latest,
    )
    .sort((left, right) => left.date.getTime() - right.date.getTime())[0];
}

/** Has she calved to this service? */
export function hasCalved(
  calvings: readonly CalvingLike[],
  breeding: Pick<BreedingRecord, "id" | "damId" | "date">,
): boolean {
  return calvingFor(calvings, breeding) !== undefined;
}

/**
 * The breedings still waiting on a calf.
 *
 * What every watch on this farm should be built from. A cow inside her window
 * is only worth watching until she calves, and nothing was ending that watch:
 * `isInCalvingWindow` can only see one breeding record, so a cow with a calf
 * at side kept her card on the dashboard, her row in the calving screen and
 * her line in the nightly weather alert for the rest of the fortnight.
 *
 * Which is the failure the card's own rule is about. A confirmed-open cow is
 * dropped because "leaving her on the dashboard for a month teaches people to
 * ignore the card", and a cow that has already calved is the same lesson
 * taught with a calf standing next to her.
 */
export function awaitingCalving(
  breedings: readonly BreedingRecord[],
  calvings: readonly CalvingLike[],
  now: Date,
  options: { defaultGestationDays?: number; windowDays?: number } = {},
): BreedingRecord[] {
  return breedings.filter(
    (record) => isInCalvingWindow(record, now, options) && !hasCalved(calvings, record),
  );
}

/**
 * How long she actually carried.
 *
 * Undefined when the calving predates the service, which is a mistyped date
 * rather than a very short pregnancy — and reporting "-40 days" as a gestation
 * would put a number nobody can act on in front of somebody who needs to fix
 * one of the two dates.
 */
export function gestationLength(
  breeding: Pick<BreedingRecord, "date">,
  calving: Pick<CalvingLike, "date">,
): number | undefined {
  const days = Math.round((calving.date.getTime() - breeding.date.getTime()) / MS_PER_DAY);
  return days < 0 ? undefined : days;
}

/**
 * Where a calving on `on` sits against what was projected.
 *
 * Said in days early or late rather than as a bare number, because that is the
 * question being asked while the form is open: a cow at day 268 is calving
 * early enough to be worth writing down, and one at day 291 has either gone
 * long or was bred to a service nobody recorded.
 */
export function describeGestation(
  breeding: Pick<BreedingRecord, "date" | "gestationDays">,
  on: Date,
  defaultGestationDays: number = DEFAULT_GESTATION_DAYS,
): string {
  const carried = gestationLength(breeding, { date: on });
  if (carried === undefined) return "That is before she was bred — check the date.";

  const projected = breeding.gestationDays ?? defaultGestationDays;
  const off = carried - projected;
  if (off === 0) return `Day ${carried}, exactly her projected date.`;

  const size = Math.abs(off);
  return `Day ${carried} — ${size} day${size === 1 ? "" : "s"} ${off < 0 ? "early" : "late"}.`;
}

/** The open breedings for one dam, most recent first. */
export function breedingsFor(records: readonly BreedingRecord[], damId: Ulid): BreedingRecord[] {
  return records
    .filter((record) => record.damId === damId)
    .sort((left, right) => right.date.getTime() - left.date.getTime());
}

/**
 * The breeding a calf born on `bornOn` came from.
 *
 * Chosen as the most recent breeding *before* the birth rather than the one
 * whose projection is closest, because a cow that calves three weeks early
 * still calved to the service that bred her, and picking by proximity would
 * credit a later service she never took to.
 *
 * Services already answered by a calving are passed over, which is the other
 * half of the link: one service, one calf. Without it a second calving on a
 * cow with one breeding on file would be credited to the service that already
 * produced her last calf, and the breeding log would show one service with two
 * calves under it.
 */
export function serviceFor(
  records: readonly BreedingRecord[],
  damId: Ulid,
  bornOn: Date,
  answered: readonly CalvingLike[] = [],
): BreedingRecord | undefined {
  return breedingsFor(records, damId).find(
    (record) => record.date < bornOn && !hasCalved(answered, record),
  );
}
