import Dexie, { type EntityTable } from "dexie";

import type { BaseRecord } from "@galaxy-farm/core";

/**
 * The on-device store (spec §4.2).
 *
 * Every read in the app comes from here. The UI never waits on the network to
 * show data, which is what makes the barn usable at zero bars — and, as a side
 * effect, makes a scale-to-zero database's cold starts invisible.
 */

export type StoredRecord = BaseRecord & Record<string, unknown>;

/**
 * Indexes are chosen for the queries that actually run:
 * `propertyId` because every read is scoped to a property, `updatedAt` for the
 * sync engine's cursors, and `deletedAt` so Trash and the default read path are
 * both cheap.
 */
export const RECORD_INDEXES = "id, propertyId, updatedAt, deletedAt, [propertyId+deletedAt]";

export interface FarmDatabaseOptions {
  readonly name?: string;
  /** Entity names to create tables for. */
  readonly stores: readonly string[];
  /**
   * Injected so tests can supply an isolated fake-indexeddb instance.
   *
   * Note that Dexie's `liveQuery` change tracking hooks the *global*
   * indexedDB, so a database built on an injected factory will read and write
   * correctly but will never emit live updates. Tests that need live queries
   * have to install fake-indexeddb globally instead. In the browser this never
   * arises — the global is the only one there is.
   */
  readonly indexedDB?: IDBFactory;
  readonly iDBKeyRange?: typeof IDBKeyRange;
}

export class FarmDatabase extends Dexie {
  constructor(options: FarmDatabaseOptions) {
    super(options.name ?? "galaxy-farm", {
      ...(options.indexedDB ? { indexedDB: options.indexedDB } : {}),
      ...(options.iDBKeyRange ? { IDBKeyRange: options.iDBKeyRange } : {}),
    });

    this.version(1).stores(
      Object.fromEntries(options.stores.map((store) => [store, RECORD_INDEXES])),
    );
  }

  /**
   * Named `records` rather than `table` so it does not collide with Dexie's
   * own `table`, whose signature is deliberately looser than this one.
   */
  records<T extends StoredRecord>(name: string): EntityTable<T, "id"> {
    return this.table(name) as unknown as EntityTable<T, "id">;
  }
}
