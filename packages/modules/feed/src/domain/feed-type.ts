import { z } from "zod";

import {
  baseRecordSchema,
  moneySchema,
  unitSchema,
  type BaseRecord,
  type Money,
  type Unit,
} from "@galaxy-farm/core";

import { measureToPounds } from "./grain-measures.js";

/**
 * What gets fed, as a catalogue entry (spec §5.3).
 *
 * Cross-species by design: the same round bale feeds cattle and the same
 * scratch feeds chickens, and §4.1 puts feed in one module rather than one per
 * animal type so the run-out projection is written once.
 */

/**
 * `pet` earns its place for the same reason the module is cross-species: a bag
 * of kibble is bought, run down, and reordered exactly like a bag of creep,
 * and §5.8 has pets carry a real FeedingPlan rather than a note. Filing dog
 * food under `supplement` would have put it in the cattle ration's totals.
 */
export const FEED_CATEGORIES = ["hay", "grain", "mineral", "creep", "supplement", "pet"] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

/**
 * The units feed is bought and fed in.
 *
 * A subset of the kernel's `UNITS` rather than a second vocabulary — §5.3
 * writes `bulk_lb` and `bulk_ton` where the kernel says `lb` and `ton`, and
 * two names for one unit is how a conversion ends up applied twice.
 */
export const FEED_UNITS = [
  "round_bale",
  "square_bale",
  "bag",
  "bucket",
  "scoop",
  "block",
  "lb",
  "ton",
] as const;
export type FeedUnit = (typeof FEED_UNITS)[number];

export interface FeedType extends BaseRecord {
  readonly name: string;
  readonly category: FeedCategory;
  readonly unit: FeedUnit;
  /**
   * Pounds in one unit, where the unit is not already a weight.
   *
   * A round bale is anywhere from 800 to 1,400 lb depending on who baled it,
   * so this is the number that makes "three bales" and "40 lb a head a day"
   * comparable at all.
   */
  readonly estWeightLbPerUnit?: number | undefined;
  readonly currentUnitCost?: Money | undefined;
  /** How long the supplier takes, which is what the reorder alert leads by. */
  readonly reorderLeadDays: number;
  /** On-hand at or below this raises a low-stock notification. */
  readonly reorderThreshold?: number | undefined;
  readonly active: boolean;
  readonly notes?: string | undefined;
}

export const feedTypeSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A feed needs a name").max(120),
  category: z.enum(FEED_CATEGORIES),
  unit: unitSchema.refine(
    (unit): unit is FeedUnit => (FEED_UNITS as readonly Unit[]).includes(unit),
    "That is not a unit feed is bought in",
  ),
  estWeightLbPerUnit: z.number().positive().max(3000).optional(),
  currentUnitCost: moneySchema.optional(),
  reorderLeadDays: z.number().int().min(0).max(180),
  reorderThreshold: z.number().min(0).optional(),
  active: z.boolean(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<FeedType>;

/**
 * Pounds in a quantity of this feed, where that can be worked out.
 *
 * The feed's own figure wins wherever it has one — a round bale is anywhere
 * from 800 to 1,400 lb and only the person who bought it knows which. Failing
 * that, the barn's own vessels have known weights: a bag is 50 lb, a bucket
 * half that, a scoop an eighteenth. Anything else comes back undefined rather
 * than guessed, because a made-up weight per unit propagates into a run-out
 * date somebody drives to town on.
 */
export function poundsOf(
  feedType: Pick<FeedType, "unit" | "estWeightLbPerUnit">,
  amount: number,
): number | undefined {
  if (feedType.unit === "lb") return amount;
  if (feedType.unit === "ton") return amount * 2000;
  if (feedType.estWeightLbPerUnit !== undefined) return amount * feedType.estWeightLbPerUnit;
  return measureToPounds(amount, feedType.unit);
}
