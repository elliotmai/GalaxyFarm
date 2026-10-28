import type { Ulid, Unit } from "@galaxy-farm/core";
import type { DurableAssignment, SupplyPurchase, SupplyUsage } from "@galaxy-farm/module-supplies";

/** The formatting the supplies screen, its lists and its forms share. */

export function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
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

/** What names each item, so the restrict rule on deleting one can say so. */
export function itemHolds(
  purchases: readonly SupplyPurchase[],
  usage: readonly SupplyUsage[],
  assignments: readonly DurableAssignment[],
): Map<Ulid, string[]> {
  const map = new Map<Ulid, string[]>();
  const note = (id: Ulid, label: string) => map.set(id, [...(map.get(id) ?? []), label]);
  for (const purchase of purchases) note(purchase.supplyItemId, "a purchase");
  for (const entry of usage) note(entry.supplyItemId, "a usage entry");
  for (const assignment of assignments) note(assignment.supplyItemId, "an assignment");
  return map;
}

/** A durable assignment that takes things off the count rather than lending them out. */
export function isEnding(assignment: Pick<DurableAssignment, "condition">): boolean {
  return assignment.condition === "retired" || assignment.condition === "lost";
}
