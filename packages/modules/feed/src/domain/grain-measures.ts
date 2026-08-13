import type { Unit } from "@galaxy-farm/core";

/**
 * The vessels grain is actually measured in (spec §5.3).
 *
 * Nobody on this place weighs feed. A bag comes off the trailer, it gets
 * tipped into buckets, and what goes in the trough is scoops. So those are the
 * units a plan is written in and the units a run-out projection has to answer
 * in — "you have four bags left" is usable at a feed store, "you have 213
 * pounds left" is not.
 *
 * The conversions are carried over from the feeding page of ZNT Manager, where
 * they were arrived at by using them:
 *
 * - **1 bag = 50 lb.** What a sack of cubes weighs.
 * - **2 buckets = 1 bag**, so a bucket is 25 lb.
 * - **18 scoops = 1 bag**, so a scoop is about 2.78 lb.
 *
 * These are *defaults*, and that distinction matters. Fifty pounds is what a
 * bag of range cubes weighs; a bucket and a scoop are this farm's own vessels
 * and a different feed in the same scoop weighs something different, because
 * cubes and a light textured feed do not fill a scoop the same way. So a feed
 * that knows its own weight per unit says so and is believed, and these are
 * what is used when it does not.
 */

/** A bag of cubes. The one figure here that is printed on the sack. */
export const POUNDS_PER_BAG = 50;

/** Two to a bag. */
export const POUNDS_PER_BUCKET = POUNDS_PER_BAG / 2;

/** Eighteen to a bag — about 2.78 lb, which is why this is not written as one. */
export const POUNDS_PER_SCOOP = POUNDS_PER_BAG / 18;

/** What each vessel holds by default, in pounds. */
export const POUNDS_PER_MEASURE: Readonly<Partial<Record<Unit, number>>> = {
  bag: POUNDS_PER_BAG,
  bucket: POUNDS_PER_BUCKET,
  scoop: POUNDS_PER_SCOOP,
  lb: 1,
  ton: 2000,
};

/** The vessels, largest first — which is the order a breakdown is read in. */
export const GRAIN_MEASURES = ["bag", "bucket", "scoop"] as const;
export type GrainMeasure = (typeof GRAIN_MEASURES)[number];

export const isGrainMeasure = (unit: Unit): unit is GrainMeasure =>
  (GRAIN_MEASURES as readonly Unit[]).includes(unit);

/**
 * An amount in one vessel, in pounds.
 *
 * `poundsPerUnit` is the feed's own figure where it has one, because a scoop of
 * cubes and a scoop of a light textured feed are not the same weight.
 */
export function measureToPounds(
  amount: number,
  unit: Unit,
  poundsPerUnit?: number | undefined,
): number | undefined {
  const per = poundsPerUnit ?? POUNDS_PER_MEASURE[unit];
  return per === undefined ? undefined : amount * per;
}

/** Pounds back into a vessel. The inverse, and it has the same caveat. */
export function poundsToMeasure(
  pounds: number,
  unit: Unit,
  poundsPerUnit?: number | undefined,
): number | undefined {
  const per = poundsPerUnit ?? POUNDS_PER_MEASURE[unit];
  return per === undefined || per === 0 ? undefined : pounds / per;
}

/**
 * Rounded to the nearest half.
 *
 * Nobody measures a third of a scoop. A figure carried to two decimals is a
 * figure that gets rounded in somebody's head anyway, and rounding it here
 * means the app and the person agree about what was fed.
 */
export const toNearestHalf = (value: number): number => Math.round(value * 2) / 2;

const plural = (amount: number, noun: string): string =>
  `${amount} ${noun}${amount === 1 ? "" : "s"}`;

/**
 * An amount of grain, said the way it would be said out loud.
 *
 * Whole vessels first, largest down: bags, then buckets, then whatever is left
 * as scoops. "2 bags + 1 bucket" is an instruction somebody can carry out at
 * the shed door; "2.5 bags" is a number they have to convert in their head,
 * and the whole reason these units exist is that nobody should have to.
 *
 * Only the last term is rounded, and a term that rounds up into the next
 * vessel is carried rather than printed — nine scoops is a bucket, and
 * "1 bucket + 9 scoops" is two buckets said badly.
 *
 * The vessel weights default to this farm's; a feed that knows its own passes
 * them in, because a scoop of cubes and a scoop of a light textured feed do
 * not weigh the same.
 */
export function describeGrain(
  pounds: number,
  weights: {
    readonly perBag?: number | undefined;
    readonly perBucket?: number | undefined;
    readonly perScoop?: number | undefined;
  } = {},
): string {
  const perBag = weights.perBag ?? POUNDS_PER_BAG;
  const perBucket = weights.perBucket ?? POUNDS_PER_BUCKET;
  const perScoop = weights.perScoop ?? POUNDS_PER_SCOOP;

  if (!Number.isFinite(pounds) || pounds <= 0) return "0 scoops";

  let left = pounds;
  let bags = Math.floor(left / perBag);
  left -= bags * perBag;
  let buckets = Math.floor(left / perBucket);
  left -= buckets * perBucket;
  let scoops = toNearestHalf(left / perScoop);

  // Carry, so the terms never add up to more than the next vessel down holds.
  if (scoops * perScoop >= perBucket) {
    scoops = 0;
    buckets += 1;
  }
  if (buckets * perBucket >= perBag) {
    buckets = 0;
    bags += 1;
  }

  const said = [
    bags > 0 ? plural(bags, "bag") : undefined,
    buckets > 0 ? plural(buckets, "bucket") : undefined,
    scoops > 0 ? plural(scoops, "scoop") : undefined,
  ].filter((part): part is string => part !== undefined);

  // Everything rounded away — under half a scoop of a feed measured in bags.
  return said.length === 0 ? "0 scoops" : said.join(" + ");
}
