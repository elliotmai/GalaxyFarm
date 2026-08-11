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
  readonly unitCost: Money;
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
  unitCost: moneySchema,
  vendorContactId: ulidSchema.optional(),
  purchasedOn: z.coerce.date(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<FeedPurchase>;

export const feedConsumptionSchema = baseRecordSchema.extend({
  feedTypeId: ulidSchema,
  quantity: z.number().positive("Record what was used, not zero"),
  kind: z.enum(CONSUMPTION_KINDS),
  usedOn: z.coerce.date(),
  animalId: ulidSchema.optional(),
  zoneId: ulidSchema.optional(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<FeedConsumption>;

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
 * The result can legitimately go negative and is deliberately not clamped: a
 * negative on-hand means the records disagree with the barn, which is worth
 * seeing rather than hiding behind a zero. The fix is a `correction` entry — a
 * record of the discrepancy rather than a silent overwrite of it.
 */
export function onHand(
  feedTypeId: Ulid,
  purchases: readonly FeedPurchase[],
  consumption: readonly FeedConsumption[],
  plannedConsumed = 0,
): number {
  const bought = purchases
    .filter((purchase) => purchase.feedTypeId === feedTypeId)
    .reduce((total, purchase) => total + purchase.quantity, 0);

  const used = consumption
    .filter((entry) => entry.feedTypeId === feedTypeId)
    .reduce((total, entry) => total + entry.quantity, 0);

  return bought - used - plannedConsumed;
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
  const corrections = consumption
    .filter((entry) => entry.feedTypeId === feedTypeId && entry.kind === "correction")
    .map((entry) => entry.usedOn);
  if (corrections.length > 0) {
    return corrections.reduce((latest, at) => (at > latest ? at : latest));
  }

  const first = purchases
    .filter((purchase) => purchase.feedTypeId === feedTypeId)
    .map((purchase) => purchase.purchasedOn);
  return first.length === 0
    ? undefined
    : first.reduce((earliest, at) => (at < earliest ? at : earliest));
}

/** What the plans imply was eaten between two dates. Never negative. */
export function plannedConsumption(demandPerDay: number, from: Date, to: Date): number {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  return days <= 0 ? 0 : demandPerDay * days;
}

/**
 * What the feed cost, averaged over what was bought.
 *
 * Weighted average rather than last-price or FIFO. Hay in a barn is fungible —
 * nobody knows which bale came from which load — and a per-head cost that
 * jumped every time a cheaper load arrived would be a number nobody could
 * explain to themselves a month later.
 */
export function weightedAverageCost(
  feedTypeId: Ulid,
  purchases: readonly FeedPurchase[],
): Money | undefined {
  const relevant = purchases.filter((purchase) => purchase.feedTypeId === feedTypeId);
  const quantity = relevant.reduce((total, purchase) => total + purchase.quantity, 0);
  if (quantity <= 0) return undefined;

  const cents = relevant.reduce(
    (total, purchase) => total + purchase.unitCost.cents * purchase.quantity,
    0,
  );
  return { cents: Math.round(cents / quantity) };
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
