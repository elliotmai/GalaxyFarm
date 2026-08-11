import { z } from "zod";

import { ulidSchema, type Ulid } from "../types/ids.js";

/**
 * Fields every record in the system carries (spec §5).
 *
 * `propertyId` is on the base type rather than added per entity because §5 says
 * a second location later must be a query filter, not a migration. The
 * soft-delete trio is here for the same reason: §4.5 clause 4 applies to every
 * entity, and a tombstone bolted on per-entity is a tombstone somebody forgets.
 */

export interface BaseRecord {
  readonly id: Ulid;
  readonly propertyId: Ulid;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Set means soft-deleted: out of normal lists, still restorable from Trash. */
  readonly deletedAt?: Date | undefined;
  readonly deletedBy?: Ulid | undefined;
  readonly deletedReason?: string | undefined;
}

export const baseRecordSchema = z.object({
  id: ulidSchema,
  propertyId: ulidSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  deletedAt: z.coerce.date().optional(),
  deletedBy: ulidSchema.optional(),
  deletedReason: z.string().max(500).optional(),
});

export function isDeleted(record: Pick<BaseRecord, "deletedAt">): boolean {
  return record.deletedAt !== undefined;
}

export function isLive(record: Pick<BaseRecord, "deletedAt">): boolean {
  return record.deletedAt === undefined;
}

/**
 * Write a tombstone. Deliberately not a `DELETE` — spec §4.5 clause 4.
 *
 * Returning a new object rather than mutating keeps this usable from a reducer
 * and keeps the sync engine's field-level patches easy to compute.
 */
export function softDelete<T extends BaseRecord>(
  record: T,
  at: Date,
  by: Ulid,
  reason?: string,
): T {
  return {
    ...record,
    deletedAt: at,
    deletedBy: by,
    ...(reason === undefined ? {} : { deletedReason: reason }),
    updatedAt: at,
  };
}

/** Bring a record back from Trash. */
export function restore<T extends BaseRecord>(record: T, at: Date): T {
  const next = { ...record, updatedAt: at };
  delete (next as { deletedAt?: Date }).deletedAt;
  delete (next as { deletedBy?: Ulid }).deletedBy;
  delete (next as { deletedReason?: string }).deletedReason;
  return next;
}

export const DEFAULT_RETENTION_DAYS = 30;

/**
 * Is a soft-deleted record past its retention window and eligible for the
 * automatic purge? Live records never are.
 */
export function isPurgeable(
  record: Pick<BaseRecord, "deletedAt">,
  now: Date,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): boolean {
  if (record.deletedAt === undefined) return false;
  const elapsedDays = (now.getTime() - record.deletedAt.getTime()) / 86_400_000;
  return elapsedDays >= retentionDays;
}

/** Filter helper — the default read path everywhere except Trash. */
export function liveOnly<T extends Pick<BaseRecord, "deletedAt">>(records: readonly T[]): T[] {
  return records.filter(isLive);
}

export function deletedOnly<T extends Pick<BaseRecord, "deletedAt">>(records: readonly T[]): T[] {
  return records.filter(isDeleted);
}
