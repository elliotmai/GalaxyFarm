import { z } from "zod";

/**
 * Money is stored in whole cents.
 *
 * Floating-point dollars drift, and this app adds up feed purchases, treatment
 * costs, hauling, and packer cheques to produce a per-animal P&L someone will
 * make decisions on. Integer cents cannot drift.
 */

export interface Money {
  /** Whole cents. Negative is allowed — a credit is a real thing. */
  readonly cents: number;
}

export const moneySchema = z.object({
  cents: z.number().int(),
});

export function money(cents: number): Money {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`Money must be whole cents, got ${cents}`);
  }
  return { cents };
}

export function fromDollars(dollars: number): Money {
  return money(Math.round(dollars * 100));
}

export function toDollars(value: Money): number {
  return value.cents / 100;
}

export function addMoney(left: Money, right: Money): Money {
  return money(left.cents + right.cents);
}

export function subtractMoney(left: Money, right: Money): Money {
  return money(left.cents - right.cents);
}

export function sumMoney(values: readonly Money[]): Money {
  return values.reduce((total, value) => addMoney(total, value), money(0));
}

/**
 * Round to the nearest cent, correcting for binary floating-point error first.
 *
 * `100 * 1.005` evaluates to 100.49999999999999, which rounds *down* and
 * quietly loses a cent. Normalising to 12 significant digits before rounding
 * recovers the value a person would have written down. Integer cents protect
 * addition; this protects scaling.
 */
function roundCents(value: number): number {
  return Math.round(Number(value.toPrecision(12)));
}

/** Used for per-head feed allocation, where the divisor is a headcount. */
export function divideMoney(value: Money, divisor: number): Money {
  if (divisor === 0) throw new RangeError("Cannot divide money by zero");
  return money(roundCents(value.cents / divisor));
}

export function multiplyMoney(value: Money, factor: number): Money {
  return money(roundCents(value.cents * factor));
}

export function compareMoney(left: Money, right: Money): number {
  return left.cents - right.cents;
}

export function formatMoney(value: Money, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(toDollars(value));
}
