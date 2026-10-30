import { fromDollars, type Money, type Ulid, type Unit } from "@galaxy-farm/core";
import type { DurableAssignment, SupplyPurchase, SupplyUsage } from "@galaxy-farm/module-supplies";

/** The formatting the supplies screen, its lists and its forms share. */

/**
 * One formatter, built once. `toLocaleDateString` with options builds a new
 * `Intl.DateTimeFormat` on every call — about a tenth of a millisecond each,
 * which on a list of a few hundred rows, dated twice a row, was most of the
 * time a save spent re-rendering the list behind its panel.
 */
const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export function formatDate(value: Date | undefined): string {
  return value === undefined ? "—" : DAY.format(value);
}

export function qty(value: number): string {
  return (Math.round(value * 100) / 100).toLocaleString();
}

export function unitLabel(unit: Unit): string {
  return unit.replace(/_/g, " ");
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function atNoon(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

export function errorMessage(error: {
  kind: string;
  issues?: readonly { message: string }[];
}): string {
  return error.kind === "validation"
    ? (error.issues?.[0]?.message ?? "That is not valid")
    : "Could not save that";
}

/** Joins the parts of a row's muted line, skipping the ones that are not there. */
export function line(...parts: readonly (string | undefined | false)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
}

/**
 * A price field's text as money, or undefined when it was left blank.
 *
 * Blank is "not recorded", never $0 — a purchase nobody priced is left out of
 * the spend rather than counted as free.
 */
export function moneyFrom(text: string): Money | undefined {
  return text.trim() === "" ? undefined : fromDollars(Number(text));
}

/** Money as a price field shows it: dollars to the cent, or blank. */
export function moneyText(value: Money | undefined): string {
  return value === undefined ? "" : (value.cents / 100).toFixed(2);
}

/**
 * What names each item, so the restrict rule on deleting one can say so.
 *
 * Appended in place: copying the array on every entry made this quadratic in
 * the size of the busiest item's history, on every render of the screen.
 */
export function itemHolds(
  purchases: readonly SupplyPurchase[],
  usage: readonly SupplyUsage[],
  assignments: readonly DurableAssignment[],
): Map<Ulid, string[]> {
  const map = new Map<Ulid, string[]>();
  const note = (id: Ulid, label: string) => {
    const held = map.get(id);
    if (held === undefined) map.set(id, [label]);
    else held.push(label);
  };
  for (const purchase of purchases) note(purchase.supplyItemId, "a purchase");
  for (const entry of usage) note(entry.supplyItemId, "a usage entry");
  for (const assignment of assignments) note(assignment.supplyItemId, "an assignment");
  return map;
}

/** A durable assignment that takes things off the count rather than lending them out. */
export function isEnding(assignment: Pick<DurableAssignment, "condition">): boolean {
  return assignment.condition === "retired" || assignment.condition === "lost";
}
