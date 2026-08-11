import { z } from "zod";

import {
  baseRecordSchema,
  daysBetween,
  ulidSchema,
  type BaseRecord,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * Weights, and what they imply (spec §5.2).
 *
 * "Birth weights are the reliable ones" — everything after that is a scale in
 * a chute and an animal that would rather not be on it. Which is why the
 * derivations here all state what they assume: ADG is linear between two
 * points, and the 205-day weight is the unadjusted one.
 */

export const WEIGHT_CONTEXTS = ["birth", "weaning", "yearling", "other"] as const;
export type WeightContext = (typeof WEIGHT_CONTEXTS)[number];

export interface WeightRecord extends BaseRecord {
  readonly animalId: Ulid;
  readonly date: Date;
  readonly weightLb: number;
  readonly context: WeightContext;
  readonly notes?: string | undefined;
}

export const weightRecordSchema = baseRecordSchema.extend({
  animalId: ulidSchema,
  date: z.coerce.date(),
  weightLb: z.number().positive("A weight has to be more than zero").max(4000),
  context: z.enum(WEIGHT_CONTEXTS),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<WeightRecord>;

/**
 * Average daily gain between two weights, in pounds per day.
 *
 * Undefined for two weights taken on the same day: the honest answer to "what
 * did she gain per day over zero days" is nothing at all, and returning a
 * division by zero as Infinity would render as a very impressive calf.
 */
export function averageDailyGain(
  from: Pick<WeightRecord, "date" | "weightLb">,
  to: Pick<WeightRecord, "date" | "weightLb">,
): number | undefined {
  const days = daysBetween(from.date, to.date);
  if (days <= 0) return undefined;
  return (to.weightLb - from.weightLb) / days;
}

/** One animal's weights, oldest first — the order a growth chart wants. */
export function weightsFor(records: readonly WeightRecord[], animalId: Ulid): WeightRecord[] {
  return records
    .filter((record) => record.animalId === animalId)
    .sort((left, right) => left.date.getTime() - right.date.getTime());
}

export function weightIn(
  records: readonly WeightRecord[],
  animalId: Ulid,
  context: WeightContext,
): WeightRecord | undefined {
  return weightsFor(records, animalId).find((record) => record.context === context);
}

/**
 * Unadjusted 205-day weaning weight.
 *
 * `((weaning − birth) ÷ age in days) × 205 + birth`, which is the standard
 * formula with the age-of-dam and sex adjustment factors left off. §5.2 is
 * explicit that those are a future enhancement, so this is deliberately the
 * unadjusted figure and must be labelled that way wherever it is shown —
 * quoting an unadjusted weight as an adjusted one to a buyer is a real problem,
 * not a rounding difference.
 */
export function unadjusted205DayWeight(
  birth: Pick<WeightRecord, "date" | "weightLb">,
  weaning: Pick<WeightRecord, "date" | "weightLb">,
): number | undefined {
  const ageDays = daysBetween(birth.date, weaning.date);
  if (ageDays <= 0) return undefined;
  return ((weaning.weightLb - birth.weightLb) / ageDays) * 205 + birth.weightLb;
}

/**
 * ADG across an animal's whole recorded history.
 *
 * First to last, not an average of the intervals: the intervals are unevenly
 * spaced, so averaging them would weight a fortnight between two chute visits
 * the same as the six months either side of it.
 */
export function lifetimeGain(records: readonly WeightRecord[], animalId: Ulid): number | undefined {
  const weights = weightsFor(records, animalId);
  const first = weights[0];
  const last = weights[weights.length - 1];
  if (first === undefined || last === undefined || first === last) return undefined;
  return averageDailyGain(first, last);
}
