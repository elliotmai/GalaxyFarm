import { z } from "zod";

/**
 * A number is not a quantity. Feed is measured in round bales, bags, and bulk
 * pounds; medicine in millilitres; weight in pounds. Pairing the amount with
 * its unit at the type level is what stops a bale being added to a bag.
 */

/**
 * `bucket` and `scoop` are the vessels in this barn, not standard measures.
 *
 * Nobody weighs out grain. The feed goes in by the scoop and comes out of the
 * shed by the bucket, and a plan written in pounds is a plan somebody has to
 * do arithmetic on twice a day in the dark. So the vessels are units in their
 * own right, and what they weigh is a property of the feed — `module-feed`
 * holds the conversions and the per-feed override.
 */
export const UNITS = [
  "lb",
  "ton",
  "round_bale",
  "square_bale",
  "bag",
  "bucket",
  "scoop",
  "block",
  "ml",
  "cc",
  "dose",
  "head",
  "each",
  "acre",
  "hour",
  "mile",
] as const;

export type Unit = (typeof UNITS)[number];

export const unitSchema = z.enum(UNITS);

export interface Quantity {
  readonly amount: number;
  readonly unit: Unit;
}

export const quantitySchema = z.object({
  amount: z.number().finite(),
  unit: unitSchema,
});

export function quantity(amount: number, unit: Unit): Quantity {
  return { amount, unit };
}

export class UnitMismatchError extends Error {
  constructor(
    readonly left: Unit,
    readonly right: Unit,
  ) {
    super(`Cannot combine quantities in ${left} and ${right}`);
    this.name = "UnitMismatchError";
  }
}

export function addQuantities(left: Quantity, right: Quantity): Quantity {
  if (left.unit !== right.unit) throw new UnitMismatchError(left.unit, right.unit);
  return quantity(left.amount + right.amount, left.unit);
}

export function subtractQuantities(left: Quantity, right: Quantity): Quantity {
  if (left.unit !== right.unit) throw new UnitMismatchError(left.unit, right.unit);
  return quantity(left.amount - right.amount, left.unit);
}

export function scaleQuantity(value: Quantity, factor: number): Quantity {
  return quantity(value.amount * factor, value.unit);
}

export function sumQuantities(values: readonly Quantity[], unit: Unit): Quantity {
  return values.reduce((total, value) => addQuantities(total, value), quantity(0, unit));
}
