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
 * Money in and money out on an animal (spec §5.2).
 *
 * Two records rather than one signed one. They read differently on a screen —
 * an acquisition asks who you bought from, a sale asks who you sold to — and
 * per-animal P&L wants them apart anyway.
 */

export const TRANSACTION_TYPES = [
  "private",
  "sale_barn",
  "auction",
  "breeding_stock",
  "show",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface AcquisitionRecord extends BaseRecord {
  readonly animalId: Ulid;
  /** Contact — who it came from. */
  readonly counterpartyId?: Ulid | undefined;
  readonly date: Date;
  readonly price: Money;
  readonly type: TransactionType;
  readonly transportNotes?: string | undefined;
  readonly notes?: string | undefined;
}

export interface SaleRecord extends BaseRecord {
  readonly animalId: Ulid;
  readonly counterpartyId?: Ulid | undefined;
  readonly date: Date;
  readonly price: Money;
  readonly type: TransactionType;
  /** What the barn took, so the net is the number that actually landed. */
  readonly commission?: Money | undefined;
  readonly transportNotes?: string | undefined;
  readonly notes?: string | undefined;
}

const transactionFields = {
  animalId: ulidSchema,
  counterpartyId: ulidSchema.optional(),
  date: z.coerce.date(),
  price: moneySchema,
  type: z.enum(TRANSACTION_TYPES),
  transportNotes: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
};

export const acquisitionRecordSchema = baseRecordSchema.extend(
  transactionFields,
) as unknown as z.ZodType<AcquisitionRecord>;

export const saleRecordSchema = baseRecordSchema.extend({
  ...transactionFields,
  commission: moneySchema.optional(),
}) as unknown as z.ZodType<SaleRecord>;

/** What a sale actually put in the bank. */
export function netSaleProceeds(sale: Pick<SaleRecord, "price" | "commission">): Money {
  return { cents: sale.price.cents - (sale.commission?.cents ?? 0) };
}

/**
 * What an animal was bought for, if it was bought.
 *
 * Home-raised calves have no acquisition record and that is the correct
 * answer, not zero — a P&L that treats "raised here" as "free" understates
 * every home-raised animal against every purchased one.
 */
export function acquisitionCost(
  records: readonly AcquisitionRecord[],
  animalId: Ulid,
): Money | undefined {
  const record = records.find((entry) => entry.animalId === animalId);
  return record?.price;
}
