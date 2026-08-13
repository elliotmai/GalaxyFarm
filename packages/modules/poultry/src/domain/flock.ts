import { z } from "zod";

import { baseRecordSchema, ulidSchema, type BaseRecord, type Ulid } from "@galaxy-farm/core";

/**
 * Chickens, and eventually quail (spec §5.4).
 *
 * §5.4 is explicit that quail "is a dropdown value, not a new module" — one
 * flock entity, a species field, and no second set of screens.
 *
 * Headcount is maintained by an adjustment log rather than being a number
 * somebody edits. §4.5: "flock headcount via its adjustment log … the log
 * entries carry the CRUD and the total re-derives". The reason is that "we
 * lost four to something last Tuesday" is the fact worth keeping; a headcount
 * that silently dropped from 18 to 14 records nothing at all.
 */

export const FLOCK_SPECIES = ["chicken", "quail"] as const;
export type FlockSpecies = (typeof FLOCK_SPECIES)[number];

export const ADJUSTMENT_REASONS = [
  "added",
  "died",
  "predator",
  "culled",
  "sold",
  "hatched",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** Which way each reason moves the count. */
export const ADJUSTMENT_DIRECTION: Readonly<Record<AdjustmentReason, 1 | -1>> = {
  added: 1,
  hatched: 1,
  died: -1,
  predator: -1,
  culled: -1,
  sold: -1,
};

export interface Flock extends BaseRecord {
  readonly name: string;
  readonly species: FlockSpecies;
  /** The coop, as a Zone. */
  readonly zoneId?: Ulid | undefined;
  readonly breedMix?: string | undefined;
  /** Count when the flock was first recorded; adjustments move it from there. */
  readonly openingCount: number;
  readonly active: boolean;
  readonly notes?: string | undefined;
}

export const flockSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A flock needs a name").max(120),
  species: z.enum(FLOCK_SPECIES),
  zoneId: ulidSchema.optional(),
  breedMix: z.string().max(500).optional(),
  openingCount: z.number().int().min(0),
  active: z.boolean(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<Flock>;

export interface FlockAdjustment extends BaseRecord {
  readonly flockId: Ulid;
  readonly reason: AdjustmentReason;
  readonly quantity: number;
  readonly occurredOn: Date;
  readonly notes?: string | undefined;
}

export const flockAdjustmentSchema = baseRecordSchema.extend({
  flockId: ulidSchema,
  reason: z.enum(ADJUSTMENT_REASONS),
  quantity: z.number().int().positive("Say how many"),
  occurredOn: z.coerce.date(),
  notes: z.string().max(1000).optional(),
}) as unknown as z.ZodType<FlockAdjustment>;

/**
 * Headcount as of a date.
 *
 * Answering "as of" rather than only "now" is what makes the log worth
 * keeping: eggs per bird for last April needs April's headcount, not today's.
 */
export function headCountOn(
  flock: Pick<Flock, "id" | "openingCount">,
  adjustments: readonly FlockAdjustment[],
  at: Date,
): number {
  return adjustments
    .filter((entry) => entry.flockId === flock.id && entry.occurredOn <= at)
    .reduce(
      (count, entry) => count + ADJUSTMENT_DIRECTION[entry.reason] * entry.quantity,
      flock.openingCount,
    );
}

/**
 * Every bird on the property as of a date.
 *
 * Retired flocks are left out: a flock that has been switched off is one whose
 * birds are gone, and counting them would put birds in the feed demand and in
 * the eggs-per-bird figure that nobody is feeding or collecting from.
 */
export function totalBirdsOn(
  flocks: readonly Flock[],
  adjustments: readonly FlockAdjustment[],
  at: Date,
): number {
  return flocks
    .filter((flock) => flock.active)
    .reduce((birds, flock) => birds + headCountOn(flock, adjustments, at), 0);
}

/** Losses over a window, which is the number that says whether to fix a fence. */
export function lossesIn(
  flockId: Ulid,
  adjustments: readonly FlockAdjustment[],
  window: { from: Date; to: Date },
): Map<AdjustmentReason, number> {
  const losses = new Map<AdjustmentReason, number>();

  for (const entry of adjustments) {
    if (entry.flockId !== flockId) continue;
    if (entry.occurredOn < window.from || entry.occurredOn > window.to) continue;
    if (ADJUSTMENT_DIRECTION[entry.reason] > 0) continue;
    losses.set(entry.reason, (losses.get(entry.reason) ?? 0) + entry.quantity);
  }

  return losses;
}
