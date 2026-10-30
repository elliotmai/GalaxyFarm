import { formatMoney, type FeedingPlan, type Money, type Ulid } from "@galaxy-farm/core";
import type { FeedConsumption, FeedPurchase } from "@galaxy-farm/module-feed";

/** The formatting the feed screen, its lists and its forms share. */

/**
 * Built once. `toLocaleDateString` with options builds a fresh formatter on
 * every call, and the lists here call it per row on every re-render — it was
 * the costliest frame in a profile of a purchase save.
 */
const DATE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const QUANTITY = new Intl.NumberFormat();

export function formatDate(value: Date | undefined): string {
  return value === undefined ? "—" : DATE.format(value);
}

export function money(value: Money | undefined): string {
  return value === undefined ? "—" : formatMoney(value);
}

/** Round to a tenth — feed is bales and bags, not milligrams. */
export function qty(value: number): string {
  return QUANTITY.format(Math.round(value * 10) / 10);
}

export function unitLabel(unit: string): string {
  return unit.replace(/_/g, " ");
}

/** Joins the parts of a row's muted line, skipping the ones that are not there. */
export function line(...parts: readonly (string | undefined | false)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
}

/**
 * What names each feed, so the restrict rule on deleting one can say so rather
 * than count. Duplicates are kept here and collapsed where they are shown.
 */
export function feedUsage(
  purchases: readonly FeedPurchase[],
  consumption: readonly FeedConsumption[],
  plans: readonly FeedingPlan[],
): Map<Ulid, string[]> {
  const map = new Map<Ulid, string[]>();
  const note = (feedTypeId: Ulid, label: string) =>
    map.set(feedTypeId, [...(map.get(feedTypeId) ?? []), label]);

  for (const purchase of purchases) note(purchase.feedTypeId, "a purchase");
  for (const entry of consumption) note(entry.feedTypeId, "a log entry");
  for (const plan of plans) {
    for (const entry of plan.lines) note(entry.feedTypeId as Ulid, `the "${plan.name}" plan`);
  }
  return map;
}
