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
    gestationDays: z.number().int().min(240).max(320).optional(),
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
 */
export function serviceFor(
  records: readonly BreedingRecord[],
  damId: Ulid,
  bornOn: Date,
): BreedingRecord | undefined {
  return breedingsFor(records, damId).find((record) => record.date < bornOn);
}
