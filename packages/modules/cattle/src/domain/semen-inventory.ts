import { z } from "zod";

import {
  baseRecordSchema,
  moneySchema,
  ulidSchema,
  type BaseRecord,
  type Money,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * The semen tank (spec §5.2).
 *
 * Straws are the one thing on this farm that is genuinely irreplaceable — a
 * bull that is dead or sold is not making more — so the count has to be right
 * and it has to refuse to go negative. §4.5 clause 2 names "straw count cannot
 * go negative" as a domain invariant by name.
 */

export interface SemenInventory extends BaseRecord {
  /** An ExternalAnimal for a purchased sire, or an own bull we collected. */
  readonly sireExternalId?: Ulid | undefined;
  readonly sireAnimalId?: Ulid | undefined;
  /** Shown when neither reference resolves to a record we hold. */
  readonly sireName: string;
  readonly strawsOnHand: number;
  readonly tank?: string | undefined;
  readonly canister?: string | undefined;
  readonly cane?: string | undefined;
  readonly source?: string | undefined;
  readonly vendorContactId?: Ulid | undefined;
  readonly pricePerStraw?: Money | undefined;
  readonly purchasedOn?: Date | undefined;
  /** Below this, §6's "low semen inventory" notification fires. */
  readonly reorderThreshold?: number | undefined;
  readonly notes?: string | undefined;
}

export const semenInventorySchema = baseRecordSchema.extend({
  sireExternalId: ulidSchema.optional(),
  sireAnimalId: ulidSchema.optional(),
  sireName: z
    .string()
    .min(1, "Name the sire — a straw with no sire cannot pedigree a calf")
    .max(160),
  strawsOnHand: z.number().int().min(0, "Straws on hand cannot be negative"),
  tank: z.string().max(80).optional(),
  canister: z.string().max(80).optional(),
  cane: z.string().max(80).optional(),
  source: z.string().max(160).optional(),
  vendorContactId: ulidSchema.optional(),
  pricePerStraw: moneySchema.optional(),
  purchasedOn: z.coerce.date().optional(),
  reorderThreshold: z.number().int().min(0).optional(),
  notes: z.string().max(5000).optional(),
}) as unknown as z.ZodType<SemenInventory>;

/** Where to find it, as it would be read off the tank map. */
export function tankLocation(
  item: Pick<SemenInventory, "tank" | "canister" | "cane">,
): string | undefined {
  const parts = [
    item.tank === undefined ? undefined : `Tank ${item.tank}`,
    item.canister === undefined ? undefined : `canister ${item.canister}`,
    item.cane === undefined ? undefined : `cane ${item.cane}`,
  ].filter((part): part is string => part !== undefined);

  return parts.length === 0 ? undefined : parts.join(", ");
}

/**
 * Draw a straw for an AI breeding.
 *
 * Refuses rather than clamping at zero. A tank showing zero when a straw was
 * actually used is a count somebody needs to fix, and silently absorbing the
 * discrepancy is how a herd sire's remaining straws become a guess.
 */
export function drawStraw(
  item: SemenInventory,
  at: Date,
  count = 1,
): { ok: true; item: SemenInventory } | { ok: false; reason: string } {
  if (count <= 0) return { ok: false, reason: "Draw at least one straw" };
  if (count > item.strawsOnHand) {
    return {
      ok: false,
      reason: `${item.sireName} has ${item.strawsOnHand} straw${item.strawsOnHand === 1 ? "" : "s"} on hand`,
    };
  }

  return {
    ok: true,
    item: { ...item, strawsOnHand: item.strawsOnHand - count, updatedAt: at },
  };
}

/** Put one back — a thaw that was not used, or a miscount corrected. */
export function returnStraw(item: SemenInventory, at: Date, count = 1): SemenInventory {
  return { ...item, strawsOnHand: item.strawsOnHand + Math.max(0, count), updatedAt: at };
}

/**
 * At or below the reorder threshold.
 *
 * An item with no threshold set never alerts, including at zero: somebody who
 * used the last straw of a bull they are done with does not need telling.
 */
export function isLowSemenInventory(
  item: Pick<SemenInventory, "strawsOnHand" | "reorderThreshold">,
): boolean {
  return item.reorderThreshold !== undefined && item.strawsOnHand <= item.reorderThreshold;
}

/** What the tank is worth, for the herd's asset picture. */
export function tankValue(items: readonly SemenInventory[]): Money {
  const cents = items.reduce(
    (total, item) => total + (item.pricePerStraw?.cents ?? 0) * item.strawsOnHand,
    0,
  );
  return { cents };
}
