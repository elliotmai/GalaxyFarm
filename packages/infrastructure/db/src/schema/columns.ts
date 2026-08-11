import { sql } from "drizzle-orm";
import { index, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Columns every table carries (spec §5).
 *
 * `property_id` is on every table rather than only where it seems needed,
 * because §5 says a second location later must be a query filter and not a
 * migration. The soft-delete trio is here for the same reason: §4.5 clause 4
 * applies to every entity, and a tombstone added per-table is one somebody
 * eventually forgets.
 */
export const baseColumns = {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  deletedBy: text("deleted_by"),
  deletedReason: text("deleted_reason"),
};

/**
 * Indexes every table wants.
 *
 * `updated_at` carries the sync cursors (§4.2). The partial index keeps the
 * default read path — which excludes tombstones — off the deleted history that
 * only Trash ever looks at.
 */
/**
 * Indexes every table wants, named per table.
 *
 * Drizzle derives an unnamed index's name from its columns, so an unnamed
 * `property_id` index would be called the same thing on all thirteen tables and
 * Postgres would reject the second one. The table name is passed in rather than
 * inferred because it is not reachable from inside the callback.
 *
 * `updated_at` carries the sync cursors (§4.2). The partial index keeps the
 * default read path — which excludes tombstones — off the deleted history that
 * only Trash ever looks at.
 */
export function baseIndexes(tableName: string) {
  return (table: { propertyId: AnyPgColumn; updatedAt: AnyPgColumn; deletedAt: AnyPgColumn }) => [
    index(`${tableName}_property_idx`).on(table.propertyId),
    index(`${tableName}_sync_cursor_idx`).on(table.updatedAt),
    index(`${tableName}_live_idx`)
      .on(table.propertyId)
      .where(sql`${table.deletedAt} is null`),
  ];
}
