import { z } from "zod";

import {
  addDays,
  baseRecordSchema,
  moneySchema,
  ulidSchema,
  type BaseRecord,
  type Money,
  type Ulid,
} from "@galaxy-farm/core";

import type { FeedType } from "./feed-type.js";

/**
 * Feed in, feed out, and when it runs out (spec §5.3).
 *
 * On-hand is derived — purchases minus consumption — rather than being a
 * number somebody keeps in step by hand. §4.5 is explicit about this shape:
 * "where an entity maintains a running total from an append-only log … the log
 * entries carry the CRUD and the total re-derives; the total itself is never
 * directly editable."
 */

export interface FeedPurchase extends BaseRecord {
  readonly feedTypeId: Ulid;
  readonly quantity: number;
  /**
   * What one unit cost, when somebody knows.
   *
   * Optional on purpose. The bales came off a neighbour's wagon and the bill
   * comes at the end of the month; refusing the purchase until then means the
   * shed count is wrong for a month, which is worse than a missing price. A
   * purchase without one still counts toward on-hand, and the cost a head says
   * it is incomplete (`costComplete`) rather than valuing the feed at $0.
   */
  readonly unitCost?: Money | undefined;
  /** Contact — the feed store or the neighbour with hay. */
  readonly vendorContactId?: Ulid | undefined;
  readonly purchasedOn: Date;
  readonly notes?: string | undefined;
}

/**
 * Feed used, over and above what the plans imply.
 *
 * Two kinds, and the difference matters to the projection: a `correction` is
 * somebody counting the barn and finding it does not match, and an `extra` is
 * feed genuinely used that no plan accounted for — a torn bag, a bale put out
 * in a cold snap. §5.3 calls for both.
 */
export const CONSUMPTION_KINDS = ["extra", "correction", "waste", "sold"] as const;
export type ConsumptionKind = (typeof CONSUMPTION_KINDS)[number];

export interface FeedConsumption extends BaseRecord {
  readonly feedTypeId: Ulid;
  readonly quantity: number;
  readonly kind: ConsumptionKind;
  readonly usedOn: Date;
  /** Where it went, when that is known — an animal, a zone, or a group. */
  readonly animalId?: Ulid | undefined;
  readonly zoneId?: Ulid | undefined;
  readonly notes?: string | undefined;
}

export const feedPurchaseSchema = baseRecordSchema.extend({
  feedTypeId: ulidSchema,
  quantity: z.number().positive("A purchase has to be more than nothing"),
  unitCost: moneySchema.optional(),
  vendorContactId: ulidSchema.optional(),
  purchasedOn: z.coerce.date(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<FeedPurchase>;

export const feedConsumptionSchema = baseRecordSchema
  .extend({
    feedTypeId: ulidSchema,
    // Zero is a real count — the shed is empty — so the floor is checked per
    // kind below rather than here.
    quantity: z.number().min(0, "A quantity cannot be negative"),
    kind: z.enum(CONSUMPTION_KINDS),
    usedOn: z.coerce.date(),
    animalId: ulidSchema.optional(),
    zoneId: ulidSchema.optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((entry) => entry.kind === "correction" || entry.quantity > 0, {
    message: "Record what was used, not zero",
    path: ["quantity"],
  }) as unknown as z.ZodType<FeedConsumption>;

/**
 * The count somebody last made of this feed, if anybody has.
 *
 * A `correction` is a person standing in the shed counting, and its quantity
 * is **what they counted** — the form calls it "On hand". Latest by the day it
 * was counted, then by when it was written, so two counts on one day resolve
 * to the second.
 */
export function lastCount(
  feedTypeId: Ulid,
  consumption: readonly FeedConsumption[],
): FeedConsumption | undefined {
  let latest: FeedConsumption | undefined;
  for (const entry of consumption) {
    if (entry.feedTypeId !== feedTypeId || entry.kind !== "correction") continue;
    if (latest === undefined || isLater(entry.usedOn, entry.createdAt, latest)) latest = entry;
  }
  return latest;
}

/** After the count: a later day, or the same day and written after it. */
function isLater(on: Date, createdAt: Date, count: FeedConsumption): boolean {
  const day = on.getTime() - count.usedOn.getTime();
  return day > 0 || (day === 0 && createdAt.getTime() > count.createdAt.getTime());
}

/**
 * What is in the barn.
 *
 * Three terms, and the third is the one that is easy to leave out: feed the
 * plans say was fed. §5.3 has daily demand "derived from active FeedingPlans"
 * and only *correctable* by manual entries — which means ordinary daily
 * feeding is never logged by hand, and an on-hand of purchases minus logged
 * entries would sit at ten bales forever while the barn emptied. The run-out
 * date would then never arrive.
 *
 * So `plannedConsumed` is what the plans imply since the last reconciliation,
 * computed by the caller (`projectFeed` does it) and passed in.
 *
 * A count replaces everything before it. Once somebody has counted the shed,
 * on-hand is that count, plus what was bought after it, less what was logged
 * after it — the purchases and entries before the count are already in the
 * number they counted. Treating the count as a deduction instead (the old
 * reading) turned "3 on hand" into "3 fewer", which is not what anybody
 * standing in a shed means.
 *
 * The result can legitimately go negative and is deliberately not clamped: a
 * negative on-hand means the records disagree with the barn, which is worth
 * seeing rather than hiding behind a zero. The fix is a count.
 */
export function onHand(
  feedTypeId: Ulid,
  purchases: readonly FeedPurchase[],
  consumption: readonly FeedConsumption[],
  plannedConsumed = 0,
): number {
  const count = lastCount(feedTypeId, consumption);
  const since = (on: Date, createdAt: Date) => count === undefined || isLater(on, createdAt, count);

  let total = count?.quantity ?? 0;
  for (const purchase of purchases) {
    if (purchase.feedTypeId !== feedTypeId) continue;
    if (since(purchase.purchasedOn, purchase.createdAt)) total += purchase.quantity;
  }
  for (const entry of consumption) {
    if (entry.feedTypeId !== feedTypeId || entry.kind === "correction") continue;
    if (since(entry.usedOn, entry.createdAt)) total -= entry.quantity;
  }

  return total - plannedConsumed;
}

/**
 * The date the count for this feed was last known to be right.
 *
 * A `correction` entry is somebody standing in the barn counting, so the
 * accrual restarts from it. Failing that, from the first purchase — before
 * which there was nothing to eat.
 */
export function lastReconciledOn(
  feedTypeId: Ulid,
  purchases: readonly FeedPurchase[],
  consumption: readonly FeedConsumption[],
): Date | undefined {
  const count = lastCount(feedTypeId, consumption);
  if (count !== undefined) return count.usedOn;

  let earliest: Date | undefined;
  for (const purchase of purchases) {
    if (purchase.feedTypeId !== feedTypeId) continue;
    if (earliest === undefined || purchase.purchasedOn < earliest) earliest = purchase.purchasedOn;
  }
  return earliest;
}

/** What the plans imply was eaten between two dates. Never negative. */
export function plannedConsumption(demandPerDay: number, from: Date, to: Date): number {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  return days <= 0 ? 0 : demandPerDay * days;
}

/** True when the purchase says what it cost. */
export function isPriced(
  purchase: Pick<FeedPurchase, "unitCost">,
): purchase is Pick<FeedPurchase, "unitCost"> & { readonly unitCost: Money } {
  return purchase.unitCost !== undefined;
}

/**
 * What one purchase cost in all, or undefined when nobody entered a price.
 *
 * Undefined rather than zero, everywhere it is read: a sum that quietly adds a
 * $0 load of hay understates the bill in exactly the way nobody notices.
 */
export function purchaseTotal(
  purchase: Pick<FeedPurchase, "unitCost" | "quantity">,
): Money | undefined {
  return purchase.unitCost === undefined
    ? undefined
    : { cents: Math.round(purchase.unitCost.cents * purchase.quantity) };
}

/**
 * What the feed cost, averaged over what was bought.
 *
 * Weighted average rather than last-price or FIFO. Hay in a barn is fungible —
 * nobody knows which bale came from which load — and a per-head cost that
 * jumped every time a cheaper load arrived would be a number nobody could
 * explain to themselves a month later.
 *
 * Averaged over the priced purchases only. An unpriced load is not a free
 * load, so it is left out of the average rather than dragging it towards
 * zero; `feedCost` says when that happened.
 */
export function weightedAverageCost(
  feedTypeId: Ulid,
  purchases: readonly FeedPurchase[],
): Money | undefined {
  return feedCost(feedTypeId, purchases).average;
}

export interface FeedCost {
  /** Weighted average of what was paid, over the purchases that say. */
  readonly average?: Money | undefined;
  /** False when any purchase of this feed has no price, or there are none. */
  readonly complete: boolean;
}

/** The average, and whether every purchase behind it had a price. */
export function feedCost(feedTypeId: Ulid, purchases: readonly FeedPurchase[]): FeedCost {
  let quantity = 0;
  let cents = 0;
  let bought = 0;
  let unpriced = 0;

  for (const purchase of purchases) {
    if (purchase.feedTypeId !== feedTypeId) continue;
    bought += 1;
    if (purchase.unitCost === undefined) {
      unpriced += 1;
      continue;
    }
    quantity += purchase.quantity;
    cents += purchase.unitCost.cents * purchase.quantity;
  }

  return {
    average: quantity <= 0 ? undefined : { cents: Math.round(cents / quantity) },
    complete: bought > 0 && unpriced === 0,
  };
}

/**
 * Daily demand for one feed type, in that feed's own unit.
 *
 * Handed in already summed rather than computed here, because the sum runs
 * over FeedingPlans and headcounts that live in the kernel and in whichever
 * module owns the animals. §5.3 owns the arithmetic; the caller owns the
 * gathering.
 */
export function dailyDemand(demandByFeedType: ReadonlyMap<Ulid, number>, feedTypeId: Ulid): number {
  return demandByFeedType.get(feedTypeId) ?? 0;
}

/**
 * When the barn runs out.
 *
 * Undefined when nothing is being fed — dividing by a demand of zero gives
 * Infinity, and a run-out date of "never" rendered on a screen is a claim the
 * app cannot support the moment somebody activates a plan.
 */
export function runOutDate(
  quantityOnHand: number,
  demandPerDay: number,
  from: Date,
): Date | undefined {
  if (demandPerDay <= 0) return undefined;
  if (quantityOnHand <= 0) return from;
  return addDays(from, Math.floor(quantityOnHand / demandPerDay));
}

/**
 * When to order, which is the run-out date less the supplier's lead time.
 *
 * §5.3 asks for the notification at `runOutDate − reorderLeadDays`. Ordering
 * on the run-out date itself is ordering a week late.
 */
export function reorderOn(
  feedType: Pick<FeedType, "reorderLeadDays">,
  runsOutOn: Date | undefined,
): Date | undefined {
  if (runsOutOn === undefined) return undefined;
  return addDays(runsOutOn, -feedType.reorderLeadDays);
}

export interface FeedProjection {
  readonly feedTypeId: Ulid;
  readonly onHand: number;
  readonly dailyDemand: number;
  readonly runsOutOn?: Date | undefined;
  readonly orderBy?: Date | undefined;
  readonly belowThreshold: boolean;
  /** True once the order-by date has arrived. */
  readonly orderNow: boolean;
  /** What the plans say has gone out since the count was last reconciled. */
  readonly plannedConsumed: number;
  readonly reconciledOn?: Date | undefined;
}

/** Everything the feed screen and the reorder notification both need. */
export function projectFeed(
  feedType: Pick<FeedType, "id" | "reorderLeadDays" | "reorderThreshold">,
  purchases: readonly FeedPurchase[],
  consumption: readonly FeedConsumption[],
  demandByFeedType: ReadonlyMap<Ulid, number>,
  now: Date,
): FeedProjection {
  const demandPerDay = dailyDemand(demandByFeedType, feedType.id);
  const reconciledOn = lastReconciledOn(feedType.id, purchases, consumption);
  const consumed =
    reconciledOn === undefined ? 0 : plannedConsumption(demandPerDay, reconciledOn, now);

  const stock = onHand(feedType.id, purchases, consumption, consumed);
  const demand = demandPerDay;
  const runsOutOn = runOutDate(stock, demand, now);
  const orderBy = reorderOn(feedType, runsOutOn);

  return {
    feedTypeId: feedType.id,
    onHand: stock,
    dailyDemand: demand,
    runsOutOn,
    orderBy,
    belowThreshold: feedType.reorderThreshold !== undefined && stock <= feedType.reorderThreshold,
    orderNow: orderBy !== undefined && now >= orderBy,
    plannedConsumed: consumed,
    reconciledOn,
  };
}
