import type { Money, PurchaseCandidate } from "@galaxy-farm/core";
import type { EquipmentCandidateDetail } from "@galaxy-farm/module-equipment";

/**
 * One formatter, built once. `toLocaleDateString` with options builds a new
 * `Intl.DateTimeFormat` on every call — about a tenth of a millisecond each,
 * which on a list of a few hundred rows, dated twice a row, was most of the
 * time a save spent re-rendering the list behind its panel.
 */
const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The formatting the comparison, the panel and the editor share. */

export function formatDate(value: Date | undefined): string {
  return value === undefined ? "—" : DAY.format(value);
}

export function num(value: number | undefined, decimals = 0): string {
  return value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/** Cents to the dollar and a half — $0.34/mi reads better than $0/mi. */
export function rate(value: Money | undefined): string {
  return value === undefined
    ? "—"
    : `$${(value.cents / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

export function detailOf(candidate: PurchaseCandidate): Partial<EquipmentCandidateDetail> {
  return (candidate.domainDetail ?? {}) as Partial<EquipmentCandidateDetail>;
}

/** How long until a sale or a listing closes — a deadline only the seller controls. */
export function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}
