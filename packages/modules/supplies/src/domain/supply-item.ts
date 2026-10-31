import { z } from "zod";

import {
  baseRecordSchema,
  moneySchema,
  unitSchema,
  ulidSchema,
  type BaseRecord,
  type Money,
  type Ulid,
  type Unit,
} from "@galaxy-farm/core";

/**
 * Everything the ranch runs on that is not feed, medicine, or engine-bearing
 * (spec §5.11, added v0.3).
 *
 * Two kinds in one entity rather than two, because the question "what have we
 * got and where is it" is the same for a bag of shavings and a show halter.
 * What differs is what happens next: a consumable is drawn down and reordered,
 * a durable is counted, assigned, and eventually retired.
 */

export const SUPPLY_KINDS = ["consumable", "durable"] as const;
export type SupplyKind = (typeof SUPPLY_KINDS)[number];

export const SUPPLY_CATEGORIES = [
  "bedding",
  "show_and_fitting",
  "tack",
  "pen_hardware",
  "feeding_gear",
  "pasture_seed_chem",
  "poultry",
  "general",
] as const;
export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number];

export interface SupplyItem extends BaseRecord {
  readonly name: string;
  readonly kind: SupplyKind;
  readonly category: SupplyCategory;
  readonly unit: Unit;
  /** Opening count. Live stock is this plus purchases minus usage. */
  readonly openingQty: number;
  readonly reorderThreshold?: number | undefined;
  readonly storageLocation?: string | undefined;
  readonly photoKey?: string | undefined;
  readonly notes?: string | undefined;
}

export const supplyItemSchema = baseRecordSchema
  .extend({
    name: z.string().min(1, "A supply needs a name").max(120),
    kind: z.enum(SUPPLY_KINDS),
    category: z.enum(SUPPLY_CATEGORIES),
    unit: unitSchema,
    openingQty: z.number().min(0),
    reorderThreshold: z.number().min(0).optional(),
    storageLocation: z.string().max(160).optional(),
    photoKey: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((item) => item.kind === "consumable" || item.reorderThreshold === undefined, {
    // A reorder threshold on a durable is a category error: you do not reorder
    // show halters when you are down to two, you buy one when one breaks.
    message: "Only consumables carry a reorder threshold",
    path: ["reorderThreshold"],
  }) as unknown as z.ZodType<SupplyItem>;

export interface SupplyPurchase extends BaseRecord {
  readonly supplyItemId: Ulid;
  readonly quantity: number;
  /**
   * What each one cost, when somebody wrote it down.
   *
   * Optional because the purchase is a fact about stock before it is a fact
   * about money: a pallet of shavings that turned up from the neighbour, or a
   * bag bought on the run with no receipt, still moves the count. Absent is
   * not zero — a purchase with no price is left out of the spend and out of
   * the cost a calf is charged, rather than dragging both down as a gift.
   */
  readonly unitCost?: Money | undefined;
  readonly vendorContactId?: Ulid | undefined;
  readonly purchasedOn: Date;
  readonly notes?: string | undefined;
}

export const supplyPurchaseSchema = baseRecordSchema.extend({
  supplyItemId: ulidSchema,
  quantity: z.number().positive("A purchase has to be more than nothing"),
  unitCost: moneySchema.optional(),
  vendorContactId: ulidSchema.optional(),
  purchasedOn: z.coerce.date(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<SupplyPurchase>;

export interface SupplyUsage extends BaseRecord {
  readonly supplyItemId: Ulid;
  readonly quantity: number;
  readonly usedOn: Date;
  /**
   * Who it was used on.
   *
   * §5.11: usage tagged to a client calf "flows straight onto its boarding
   * invoice lines in Phase 5" — this is the mechanism behind the "owners pay
   * for all feed and supplies" rule, so it is a field rather than a note.
   */
  readonly animalId?: Ulid | undefined;
  readonly zoneId?: Ulid | undefined;
  readonly notes?: string | undefined;
}

export const supplyUsageSchema = baseRecordSchema.extend({
  supplyItemId: ulidSchema,
  quantity: z.number().positive("Record what was used, not zero"),
  usedOn: z.coerce.date(),
  animalId: ulidSchema.optional(),
  zoneId: ulidSchema.optional(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<SupplyUsage>;

/** What one purchase cost in all, or undefined when it carries no price. */
export function purchaseTotal(
  purchase: Pick<SupplyPurchase, "quantity" | "unitCost">,
): Money | undefined {
  return purchase.unitCost === undefined
    ? undefined
    : { cents: Math.round(purchase.unitCost.cents * purchase.quantity) };
}

/** Everything spent across purchases, counting only the ones with a price. */
export function supplySpend(
  purchases: readonly Pick<SupplyPurchase, "quantity" | "unitCost">[],
): Money {
  let cents = 0;
  for (const purchase of purchases) cents += purchaseTotal(purchase)?.cents ?? 0;
  return { cents };
}

/**
 * On hand for every item at once, in one pass over each ledger.
 *
 * `stockOnHand` walks both ledgers for the one item it is asked about, which
 * is right for one item and quadratic for a shelf: thirty items over a year of
 * usage is thirty walks of the same twelve hundred rows on every render.
 */
export function stockByItem(
  items: readonly Pick<SupplyItem, "id" | "openingQty">[],
  purchases: readonly Pick<SupplyPurchase, "supplyItemId" | "quantity">[],
  usage: readonly Pick<SupplyUsage, "supplyItemId" | "quantity">[],
): Map<Ulid, number> {
  const stock = new Map<Ulid, number>();
  for (const item of items) stock.set(item.id, item.openingQty);
  for (const purchase of purchases) {
    const held = stock.get(purchase.supplyItemId);
    if (held !== undefined) stock.set(purchase.supplyItemId, held + purchase.quantity);
  }
  for (const entry of usage) {
    const held = stock.get(entry.supplyItemId);
    if (held !== undefined) stock.set(entry.supplyItemId, held - entry.quantity);
  }
  return stock;
}

/** Opening count plus purchases minus usage (§4.5: the total re-derives). */
export function stockOnHand(
  item: Pick<SupplyItem, "id" | "openingQty">,
  purchases: readonly SupplyPurchase[],
  usage: readonly SupplyUsage[],
): number {
  const bought = purchases
    .filter((purchase) => purchase.supplyItemId === item.id)
    .reduce((total, purchase) => total + purchase.quantity, 0);
  const used = usage
    .filter((entry) => entry.supplyItemId === item.id)
    .reduce((total, entry) => total + entry.quantity, 0);

  return item.openingQty + bought - used;
}

/** At or below the threshold. Durables never raise it — see the schema. */
export function isLowStock(
  item: Pick<SupplyItem, "kind" | "reorderThreshold">,
  onHand: number,
): boolean {
  return (
    item.kind === "consumable" &&
    item.reorderThreshold !== undefined &&
    onHand <= item.reorderThreshold
  );
}

/**
 * What one animal's supplies cost over a period.
 *
 * Valued at weighted-average purchase cost, matching feed (§5.3) — the two
 * land on the same invoice and a client would notice if they were costed
 * differently.
 */
export function usageCostFor(
  animalId: Ulid,
  usage: readonly SupplyUsage[],
  purchases: readonly SupplyPurchase[],
  window?: { from: Date; to: Date },
): Money {
  // Only priced purchases set the average. One bought with no receipt says
  // nothing about what a bag costs, and counting it as free would undercharge
  // every calf that used the bags it brought in.
  const costOf = (supplyItemId: Ulid): number => {
    let quantity = 0;
    let cents = 0;
    for (const purchase of purchases) {
      if (purchase.supplyItemId !== supplyItemId || purchase.unitCost === undefined) continue;
      quantity += purchase.quantity;
      cents += purchase.unitCost.cents * purchase.quantity;
    }
    return quantity <= 0 ? 0 : cents / quantity;
  };

  const cents = usage
    .filter((entry) => entry.animalId === animalId)
    .filter(
      (entry) => window === undefined || (entry.usedOn >= window.from && entry.usedOn <= window.to),
    )
    .reduce((total, entry) => total + costOf(entry.supplyItemId) * entry.quantity, 0);

  return { cents: Math.round(cents) };
}
