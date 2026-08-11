import { z } from "zod";

import {
  addDays,
  baseRecordSchema,
  moneySchema,
  quantitySchema,
  ulidSchema,
  type BaseRecord,
  type Money,
  type Quantity,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * Health, and the withdrawal clock (spec §5.2).
 *
 * The withdrawal end date is the one derived value in this app with a legal
 * edge to it: an animal treated with a product carrying a withdrawal period
 * must not enter the food chain until it passes. §5.2 calls for "a hard flag
 * on the animal until it passes (critical for beef)", and that flag is
 * computed here rather than stored, so correcting a treatment date moves the
 * clearance date with it.
 */

export const HEALTH_RECORD_TYPES = [
  "vaccination",
  "treatment",
  "exam",
  "injury",
  "deworming",
] as const;
export type HealthRecordType = (typeof HEALTH_RECORD_TYPES)[number];

export const ROUTES = [
  "subcutaneous",
  "intramuscular",
  "intravenous",
  "oral",
  "topical",
  "intranasal",
] as const;
export type AdministrationRoute = (typeof ROUTES)[number];

export interface HealthRecord extends BaseRecord {
  readonly animalId: Ulid;
  readonly type: HealthRecordType;
  readonly date: Date;
  readonly product?: string | undefined;
  /** The stock this drew from, so on-hand decrements and cost is known. */
  readonly medInventoryId?: Ulid | undefined;
  readonly dose?: Quantity | undefined;
  readonly route?: AdministrationRoute | undefined;
  /** Free text: "Kaitlyn", "Dr. Reyes" — not every hand is a user account. */
  readonly administeredBy?: string | undefined;
  /** Contact, for the vet who came out. */
  readonly vetContactId?: Ulid | undefined;
  readonly cost?: Money | undefined;
  /**
   * Copied from the product at the time of treatment, not read through to the
   * inventory record. A label change next year must not silently move a
   * clearance date that somebody already sold an animal against.
   */
  readonly withdrawalDays?: number | undefined;
  /** Scheduled second shot, for a vaccination that needs one. */
  readonly boosterDueOn?: Date | undefined;
  readonly notes?: string | undefined;
}

export const healthRecordSchema = baseRecordSchema
  .extend({
    animalId: ulidSchema,
    type: z.enum(HEALTH_RECORD_TYPES),
    date: z.coerce.date(),
    product: z.string().max(160).optional(),
    medInventoryId: ulidSchema.optional(),
    dose: quantitySchema.optional(),
    route: z.enum(ROUTES).optional(),
    administeredBy: z.string().max(120).optional(),
    vetContactId: ulidSchema.optional(),
    cost: moneySchema.optional(),
    withdrawalDays: z.number().int().min(0).max(365).optional(),
    boosterDueOn: z.coerce.date().optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((record) => record.boosterDueOn === undefined || record.boosterDueOn > record.date, {
    message: "A booster is due after the shot, not before it",
    path: ["boosterDueOn"],
  }) as unknown as z.ZodType<HealthRecord>;

/**
 * The date an animal is clear of this treatment.
 *
 * Undefined when the product carries no withdrawal — which is not the same as
 * a withdrawal of zero days, and the distinction shows on the animal's page as
 * "no withdrawal" rather than "cleared today".
 */
export function withdrawalEndDate(
  record: Pick<HealthRecord, "date" | "withdrawalDays">,
): Date | undefined {
  if (record.withdrawalDays === undefined) return undefined;
  return addDays(record.date, record.withdrawalDays);
}

/** Is this treatment still holding the animal back? */
export function isUnderWithdrawal(
  record: Pick<HealthRecord, "date" | "withdrawalDays">,
  now: Date,
): boolean {
  const end = withdrawalEndDate(record);
  return end !== undefined && now < end;
}

export interface WithdrawalStatus {
  readonly animalId: Ulid;
  readonly clearsOn: Date;
  readonly product?: string | undefined;
  readonly daysRemaining: number;
}

/**
 * Everything currently held back, latest clearance winning.
 *
 * The latest date is the one that matters: two treatments a week apart clear
 * on the later of the two, and reporting the earlier one would clear an animal
 * that is not clear. Ordered by clearance date so the withdrawal board reads
 * as a queue.
 */
export function animalsUnderWithdrawal(
  records: readonly HealthRecord[],
  now: Date,
): WithdrawalStatus[] {
  const latest = new Map<Ulid, WithdrawalStatus>();

  for (const record of records) {
    if (!isUnderWithdrawal(record, now)) continue;
    const clearsOn = withdrawalEndDate(record) as Date;
    const existing = latest.get(record.animalId);
    if (existing !== undefined && existing.clearsOn >= clearsOn) continue;

    latest.set(record.animalId, {
      animalId: record.animalId,
      clearsOn,
      product: record.product,
      daysRemaining: Math.ceil((clearsOn.getTime() - now.getTime()) / 86_400_000),
    });
  }

  return [...latest.values()].sort(
    (left, right) => left.clearsOn.getTime() - right.clearsOn.getTime(),
  );
}

/** Can this animal go to the packer or the sale barn today? */
export function isClearForSale(
  records: readonly HealthRecord[],
  animalId: Ulid,
  now: Date,
): boolean {
  return !records.some((record) => record.animalId === animalId && isUnderWithdrawal(record, now));
}

export interface BoosterDue {
  readonly record: HealthRecord;
  readonly dueOn: Date;
  readonly overdue: boolean;
}

/**
 * Boosters coming up, and the ones already missed.
 *
 * A booster is "given" when a later vaccination of the same product exists for
 * the animal — there is no separate completion flag, because the second shot
 * is itself a health record and asking someone to log it twice guarantees the
 * two disagree.
 */
export function boosterDue(
  records: readonly HealthRecord[],
  now: Date,
  leadDays = 7,
): BoosterDue[] {
  const horizon = addDays(now, leadDays);

  return records
    .filter((record) => record.boosterDueOn !== undefined)
    .filter((record) => {
      const given = records.some(
        (other) =>
          other.id !== record.id &&
          other.animalId === record.animalId &&
          other.product === record.product &&
          other.date >= (record.boosterDueOn as Date),
      );
      return !given && (record.boosterDueOn as Date) <= horizon;
    })
    .map((record) => ({
      record,
      dueOn: record.boosterDueOn as Date,
      overdue: (record.boosterDueOn as Date) < now,
    }))
    .sort((left, right) => left.dueOn.getTime() - right.dueOn.getTime());
}

/** One animal's history, most recent first. */
export function healthHistoryFor(records: readonly HealthRecord[], animalId: Ulid): HealthRecord[] {
  return records
    .filter((record) => record.animalId === animalId)
    .sort((left, right) => right.date.getTime() - left.date.getTime());
}
