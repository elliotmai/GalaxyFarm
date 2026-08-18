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

/**
 * The outbox is not a record store, and is not optional.
 *
 * Its entries have no `propertyId`, no `updatedAt`, and no tombstone — they are
 * queued work, not data — so indexing them like records would index three
 * fields that do not exist. And every device that has a local store has an
 * outbox: a store without one accepts writes it can never send, which is the
 * one failure this whole architecture is built to prevent. So the table is
 * created unconditionally rather than being something a caller lists.
 */
export const OUTBOX_STORE = "outbox";
export const OUTBOX_INDEXES = "id, queuedAt, attempts";

/**
 * Photo bytes waiting for a connection, and the same argument again.
 *
 * Queued work rather than data, so it is indexed like the outbox rather than
 * like a record, and it is created unconditionally for the same reason: a
 * device that can take a photograph with no signal and has nowhere to put the
 * bytes has lost them, which is the one failure this architecture exists to
 * prevent (spec §4.2).
 */
export const UPLOADS_STORE = "photoUploads";
export const UPLOADS_INDEXES = "id, queuedAt, attempts";

/**
 * The schema version that introduced the upload queue.
 *
 * Declared here rather than folded into the version history above, because the
 * history is what upgrades a device in place: a browser holding unsynced work
 * at version 14 has to be told what changed at 15, and rewriting version 2 to
 * mention a table that did not exist then would describe a database nobody
 * ever had.
 */
export const UPLOADS_SCHEMA_VERSION = 15;

/**
 * The last version whose schema this file describes on its own.
 *
 * IndexedDB will not create an object store for a database it has already
 * opened unless the version number goes up. So adding an entity to the store
 * list is not enough — a browser that has run the app before keeps the tables
 * it had, and the first write to a new one throws `InvalidTableError`, which is
 * exactly how the outbox went missing in v1. Callers pass `schemaVersion` and
 * bump it whenever they change `stores`.
 */
export const BASE_SCHEMA_VERSION = 2;

export interface FarmDatabaseOptions {
  readonly name?: string;
  /** Entity names to create tables for. */
  readonly stores: readonly string[];
  /** Bump whenever `stores` changes. See `BASE_SCHEMA_VERSION`. */
  readonly schemaVersion?: number;
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

    const records = Object.fromEntries(
      options.stores
        .filter((store) => store !== OUTBOX_STORE)
        .map((store) => [store, RECORD_INDEXES]),
    );

    // Version 1 shipped without the outbox table, and a browser that already
    // holds one will not open against a changed version 1 — Dexie needs the
    // history, not just the destination. Declaring both is what upgrades an
    // existing device in place instead of asking somebody to clear site data,
    // which on this app means throwing away work that has not synced yet.
    const withOutbox = { ...records, [OUTBOX_STORE]: OUTBOX_INDEXES };
    this.version(1).stores(records);
    this.version(2).stores(withOutbox);

    // Later versions carry the same *shape* — the difference is which entities
    // are in `records`, which is why the version has to move for a device that
    // has opened the database before to gain the new tables.
    const version = options.schemaVersion ?? BASE_SCHEMA_VERSION;
    if (version > BASE_SCHEMA_VERSION) {
      this.version(version).stores(
        version >= UPLOADS_SCHEMA_VERSION
          ? { ...withOutbox, [UPLOADS_STORE]: UPLOADS_INDEXES }
          : withOutbox,
      );
    }
  }

  /**
   * Named `records` rather than `table` so it does not collide with Dexie's
   * own `table`, whose signature is deliberately looser than this one.
   */
  records<T extends StoredRecord>(name: string): EntityTable<T, "id"> {
    return this.table(name) as unknown as EntityTable<T, "id">;
  }
}
