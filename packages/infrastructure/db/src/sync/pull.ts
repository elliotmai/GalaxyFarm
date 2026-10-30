import { and, asc, eq, gte, lt, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { BaseRecord, Cursor, CursorSet, PullPage, Ulid } from "@galaxy-farm/core";

import { rowToRecord, type Database } from "../repositories/postgres-repository.js";
import { columnsFor, tableFor, SYNCED_ENTITIES } from "./entities.js";

/**
 * Serving a pull (spec §4.2).
 *
 * Everything the property has changed since the device's cursor, tombstones
 * included — a deletion travels as a record, because a record that simply
 * stopped appearing would live on forever on the device that missed the pull.
 */

/**
 * Records per entity per page. Small enough that a phone on one bar in a barn
 * finishes a request; the engine keeps asking while `hasMore` is set.
 */
export const DEFAULT_PULL_LIMIT = 200;

export interface PullContext {
  /** From the authenticated session, never from the request body. */
  readonly propertyId: Ulid;
  readonly cursors: CursorSet;
  /** Which entities the device holds a store for. */
  readonly entities: readonly string[];
  readonly limit?: number;
}

export async function pullSince<T extends BaseRecord = BaseRecord>(
  db: Database,
  context: PullContext,
): Promise<PullPage<T>[]> {
  const limit = context.limit ?? DEFAULT_PULL_LIMIT;
  const pages: PullPage<T>[] = [];

  for (const entity of context.entities) {
    // An unknown entity is skipped rather than refused: a device on an older
    // build asking for something this deploy renamed should still sync
    // everything else.
    const table = tableFor(entity);
    if (table === undefined) continue;

    const rows = (await db
      .select()
      .from(table)
      .where(
        and(eq(table.propertyId, context.propertyId), newerThan(table, context.cursors[entity])),
      )
      // Ordered exactly as the cursor is compared, or a page boundary could
      // skip a record that no later pull would ever return — so by the
      // millisecond, as the cursor holds it (see `newerThan`).
      .orderBy(asc(atMillisecond(table.updatedAt)), asc(sql`${table.id} collate "C"`))
      // One extra row, purely to answer "is there more?" without a count.
      .limit(limit + 1)) as Record<string, unknown>[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    if (page.length === 0 && !hasMore) continue;

    const columns = columnsFor(table);
    pages.push({
      entity,
      records: page.map((row) => rowToRecord<T>(columns, row)),
      hasMore,
    });
  }

  return pages;
}

/**
 * Strictly newer than the cursor, in `(updatedAt, id)` order.
 *
 * The id tie-break is what makes paging safe inside a single millisecond: two
 * records stamped identically would otherwise be split across a page boundary
 * arbitrarily, and one of them would never be returned again.
 *
 * **Compared at the millisecond, because that is all a cursor holds.** The
 * cursor is a JavaScript `Date`; Postgres keeps microseconds. A row stamped by
 * SQL — every repair migration sets `updated_at = now()`, and so does anything
 * written by hand — is `…:41.825183`, the device's cursor after pulling it is
 * `…:41.825`, and `.825183 > .825` is true for ever. The device was handed the
 * same rows on every pull; with more than a page of them the engine went round
 * all twenty of its rounds each sync, rewriting the same records into the local
 * store and waking every screen on each round. That was the slow save: the
 * write was instant, and the sync behind it took seven seconds here and far
 * longer on a phone.
 *
 * The bounds are written as a range on the raw column (`>= next millisecond`,
 * or inside the cursor's millisecond with a larger id) so the cursor index
 * still narrows the scan.
 */
function newerThan(
  table: { readonly updatedAt: PgColumn; readonly id: PgColumn },
  cursor: Cursor | undefined,
) {
  if (cursor === undefined) return undefined;
  const from = cursor.updatedAt;
  const next = new Date(from.getTime() + 1);
  return or(
    gte(table.updatedAt, next),
    and(
      gte(table.updatedAt, from),
      lt(table.updatedAt, next),
      sql`${table.id} collate "C" > ${cursor.lastId}`,
    ),
  );
}

/** A timestamp truncated to the precision a device's cursor carries. */
function atMillisecond(column: PgColumn) {
  return sql`date_trunc('milliseconds', ${column})`;
}

/** Everything a device should hold a store for. */
export function syncedEntities(): readonly string[] {
  return SYNCED_ENTITIES;
}
