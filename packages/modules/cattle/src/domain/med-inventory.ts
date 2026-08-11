import { z } from "zod";

import {
  addDays,
  baseRecordSchema,
  moneySchema,
  quantitySchema,
  ulidSchema,
  type BaseRecord,
  type Money,
  type Quantity,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * The medicine fridge (spec §5.2).
 *
 * Two things hang off it: expiry alerts, and the default withdrawal days a
 * treatment copies at the moment it is given. The copy matters — see
 * `HealthRecord.withdrawalDays` — because a label change must not move a
 * clearance date somebody has already acted on.
 */

export const MED_CATEGORIES = [
  "vaccine",
  "antibiotic",
  "dewormer",
  "anti_inflammatory",
  "implant",
  "supplement",
  "other",
] as const;
export type MedCategory = (typeof MED_CATEGORIES)[number];

export interface MedInventory extends BaseRecord {
  readonly product: string;
  readonly category: MedCategory;
  readonly onHand: Quantity;
  readonly expiresOn?: Date | undefined;
  readonly lotNumber?: string | undefined;
  readonly unitCost?: Money | undefined;
  /** Copied onto each treatment; §5.2's `defaultWithdrawalDays`. */
  readonly defaultWithdrawalDays?: number | undefined;
  readonly storageLocation?: string | undefined;
  readonly vendorContactId?: Ulid | undefined;
  readonly notes?: string | undefined;
}

export const medInventorySchema = baseRecordSchema.extend({
  product: z.string().min(1, "A product needs a name").max(160),
  category: z.enum(MED_CATEGORIES),
  onHand: quantitySchema,
  expiresOn: z.coerce.date().optional(),
  lotNumber: z.string().max(80).optional(),
  unitCost: moneySchema.optional(),
  defaultWithdrawalDays: z.number().int().min(0).max(365).optional(),
  storageLocation: z.string().max(160).optional(),
  vendorContactId: ulidSchema.optional(),
  notes: z.string().max(5000).optional(),
}) as unknown as z.ZodType<MedInventory>;

/** Already past its date. */
export function isExpired(item: Pick<MedInventory, "expiresOn">, now: Date): boolean {
  return item.expiresOn !== undefined && item.expiresOn <= now;
}

/**
 * Expiring inside the lead time, expired ones first.
 *
 * Expired stock stays in the list rather than dropping out of it. A bottle
 * that went out of date last month is still in the fridge and still the one
 * somebody will reach for at six in the morning.
 */
export function expiringSoon(
  items: readonly MedInventory[],
  now: Date,
  leadDays = 30,
): MedInventory[] {
  const horizon = addDays(now, leadDays);

  return items
    .filter((item) => item.expiresOn !== undefined && item.expiresOn <= horizon)
    .sort(
      (left, right) => (left.expiresOn as Date).getTime() - (right.expiresOn as Date).getTime(),
    );
}

/**
 * Draw a dose.
 *
 * Refuses to go negative — §4.5 clause 2 names exactly this class of invariant
 * as domain logic rather than form validation. A fridge showing minus two
 * bottles is a fridge nobody trusts, and the honest reading of the situation
 * is that the count was wrong before the dose, not after it.
 */
export function drawDose(
  item: MedInventory,
  amount: Quantity,
  at: Date,
): { ok: true; item: MedInventory } | { ok: false; reason: string } {
  if (amount.unit !== item.onHand.unit) {
    return {
      ok: false,
      reason: `Cannot draw ${amount.unit} from stock held in ${item.onHand.unit}`,
    };
  }
  if (amount.amount <= 0) return { ok: false, reason: "A dose has to be more than nothing" };
  if (amount.amount > item.onHand.amount) {
    return {
      ok: false,
      reason: `Only ${item.onHand.amount} ${item.onHand.unit} on hand — correct the count first`,
    };
  }

  return {
    ok: true,
    item: {
      ...item,
      onHand: { amount: item.onHand.amount - amount.amount, unit: item.onHand.unit },
      updatedAt: at,
    },
  };
}
