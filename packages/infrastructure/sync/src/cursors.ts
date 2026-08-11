import type { FieldValue } from "./patch.js";

/**
 * Pull cursors (spec §4.2).
 *
 * One `updatedAt` cursor per entity type rather than a single global one, so a
 * busy entity cannot starve a quiet one and a failed pull only replays its own
 * slice.
 */

export interface Cursor {
  readonly entity: string;
  readonly updatedAt: Date;
  /** Tie-break within the same millisecond so nothing is skipped or repeated. */
  readonly lastId: string;
}

export type CursorSet = Readonly<Record<string, Cursor>>;

export function cursorFor(cursors: CursorSet, entity: string): Cursor | undefined {
  return cursors[entity];
}

/**
 * Advance a cursor past a page of records.
 *
 * Never moves backwards: an out-of-order response must not rewind the cursor
 * and cause the same page to be pulled forever.
 */
export function advance(
  cursors: CursorSet,
  entity: string,
  page: readonly { readonly id: string; readonly updatedAt: Date }[],
): CursorSet {
  if (page.length === 0) return cursors;

  const newest = page.reduce((latest, record) => {
    if (record.updatedAt.getTime() > latest.updatedAt.getTime()) return record;
    if (record.updatedAt.getTime() === latest.updatedAt.getTime() && record.id > latest.id) {
      return record;
    }
    return latest;
  });

  const existing = cursors[entity];
  if (existing !== undefined) {
    const notNewer =
      newest.updatedAt.getTime() < existing.updatedAt.getTime() ||
      (newest.updatedAt.getTime() === existing.updatedAt.getTime() && newest.id <= existing.lastId);
    if (notNewer) return cursors;
  }

  return { ...cursors, [entity]: { entity, updatedAt: newest.updatedAt, lastId: newest.id } };
}

/** Records strictly newer than the cursor — the server's pull filter. */
export function since(
  cursor: Cursor | undefined,
  records: readonly { readonly id: string; readonly updatedAt: Date }[],
): typeof records {
  if (cursor === undefined) return records;
  return records.filter((record) => {
    const delta = record.updatedAt.getTime() - cursor.updatedAt.getTime();
    if (delta > 0) return true;
    return delta === 0 && record.id > cursor.lastId;
  });
}

/**
 * A deletion travels as a tombstone, never as an absence.
 *
 * If a delete were expressed by the record simply not appearing in a pull, a
 * device that missed the pull would keep its copy forever — and the next time
 * it pushed, the record would come back from the dead.
 */
export interface Tombstone {
  readonly entity: string;
  readonly recordId: string;
  readonly deletedAt: Date;
  readonly deletedBy: string;
}

export function isTombstone(record: Readonly<Record<string, FieldValue>>): boolean {
  return record["deletedAt"] !== undefined && record["deletedAt"] !== null;
}
