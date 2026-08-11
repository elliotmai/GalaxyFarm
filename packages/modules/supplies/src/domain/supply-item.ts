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
  readonly unitCost: Money;
  readonly vendorContactId?: Ulid | undefined;
  readonly purchasedOn: Date;
  readonly notes?: string | undefined;
}

export const supplyPurchaseSchema = baseRecordSchema.extend({
  supplyItemId: ulidSchema,
  quantity: z.number().positive("A purchase has to be more than nothing"),
  unitCost: moneySchema,
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
  const costOf = (supplyItemId: Ulid): number => {
    const relevant = purchases.filter((purchase) => purchase.supplyItemId === supplyItemId);
    const quantity = relevant.reduce((total, purchase) => total + purchase.quantity, 0);
    if (quantity <= 0) return 0;
    const cents = relevant.reduce(
      (total, purchase) => total + purchase.unitCost.cents * purchase.quantity,
      0,
    );
    return cents / quantity;
  };

  const cents = usage
    .filter((entry) => entry.animalId === animalId)
    .filter(
      (entry) => window === undefined || (entry.usedOn >= window.from && entry.usedOn <= window.to),
    )
    .reduce((total, entry) => total + costOf(entry.supplyItemId) * entry.quantity, 0);

  return { cents: Math.round(cents) };
}
