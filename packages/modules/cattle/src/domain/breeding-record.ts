import { z } from "zod";

import {
  addDays,
  baseRecordSchema,
  daysBetween,
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
  /** An on-farm bull, for `natural`. */
  readonly bullId?: Ulid | undefined;
  /** The straw drawn, for `AI`. Decrements semen inventory. */
  readonly semenInventoryId?: Ulid | undefined;
  /** Sire as an ExternalAnimal, when the semen is not from stock we track. */
  readonly sireExternalId?: Ulid | undefined;
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
    embryoDonorId: ulidSchema.optional(),
    embryoCode: z.string().max(80).optional(),
    date: z.coerce.date(),
    technicianId: ulidSchema.optional(),
    syncProtocolId: ulidSchema.optional(),
    pregCheck: pregCheckSchema.optional(),
    gestationDays: z.number().int().min(240).max(320).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((record) => record.method !== "natural" || record.bullId !== undefined, {
    message: "A natural service needs the bull",
    path: ["bullId"],
  })
  .refine(
    (record) =>
      record.method !== "AI" ||
      record.semenInventoryId !== undefined ||
      record.sireExternalId !== undefined,
    // Either the straw from stock or, for semen bought and used the same day,
    // the sire it came from. A breeding with neither cannot pedigree the calf.
    { message: "An AI breeding needs a straw or a named sire", path: ["semenInventoryId"] },
  )
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

/** Days along she is, which is how a calving-watch alert says it out loud. */
export function daysBred(record: Pick<BreedingRecord, "date">, now: Date): number {
  return daysBetween(record.date, now);
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
