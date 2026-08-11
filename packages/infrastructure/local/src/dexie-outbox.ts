import { isStuck, type OutboxEntry, type OutboxStore, type Ulid } from "@galaxy-farm/core";

import { OUTBOX_STORE, type FarmDatabase, type StoredRecord } from "./database.js";

/**
 * The outbox, persisted to IndexedDB.
 *
 * This is what makes the headline promise true. An in-memory outbox loses
 * everything if the app is killed — which, on a phone in a barn with the screen
 * off and the battery low, is not a hypothetical. A treatment logged at the
 * chute has to still be there tomorrow morning.
 */

// Declared in `database.ts` so the table can be created unconditionally —
// re-exported here because this is where callers look for it.
export { OUTBOX_STORE, OUTBOX_INDEXES } from "./database.js";

/** Dexie stores plain data, so the entry is flattened on the way in. */
interface StoredOutboxEntry extends Record<string, unknown> {
  readonly id: string;
  readonly operation: OutboxEntry["operation"];
  readonly patch: OutboxEntry["patch"];
  readonly queuedAt: Date;
  readonly deviceId: string;
  readonly attempts: number;
  readonly lastError?: string;
}

export class DexieOutbox implements OutboxStore {
  constructor(private readonly db: FarmDatabase) {}

  async append(entry: OutboxEntry): Promise<void> {
    // put, not add — re-appending the same entry after an ambiguous failure
    // must not enqueue it twice.
    await this.table().put(toStored(entry) as unknown as StoredRecord);
  }

  async pending(limit?: number): Promise<OutboxEntry[]> {
    // ULIDs sort by creation time, so ordering by the primary key is
    // chronological without a separate sequence column.
    const rows = (await this.table().orderBy("id").toArray()) as unknown as StoredOutboxEntry[];
    const entries = rows.map(fromStored);
    return limit === undefined ? entries : entries.slice(0, limit);
  }

  async ack(ids: readonly Ulid[]): Promise<void> {
    if (ids.length === 0) return;
    await this.table().bulkDelete([...ids]);
  }

  async fail(id: Ulid, error: string): Promise<void> {
    const existing = (await this.table().get(id)) as unknown as StoredOutboxEntry | undefined;
    if (existing === undefined) return;

    await this.table().put({
      ...existing,
      attempts: existing.attempts + 1,
      lastError: error,
    } as unknown as StoredRecord);
  }

  async defer(id: Ulid, error: string): Promise<void> {
    const existing = (await this.table().get(id)) as unknown as StoredOutboxEntry | undefined;
    if (existing === undefined) return;

    // Why it did not go, without counting it against the entry. A server that
    // was down is not a verdict on what somebody typed.
    await this.table().put({ ...existing, lastError: error } as unknown as StoredRecord);
  }

  async stuck(): Promise<OutboxEntry[]> {
    const rows = (await this.table().toArray()) as unknown as StoredOutboxEntry[];
    return rows.map(fromStored).filter(isStuck);
  }

  async revive(ids: readonly Ulid[]): Promise<void> {
    for (const id of ids) {
      const existing = (await this.table().get(id)) as unknown as StoredOutboxEntry | undefined;
      if (existing === undefined) continue;
      await this.table().put({ ...existing, attempts: 0 } as unknown as StoredRecord);
    }
  }

  async size(): Promise<number> {
    return this.table().count();
  }

  private table() {
    return this.db.records<StoredRecord>(OUTBOX_STORE);
  }
}

function toStored(entry: OutboxEntry): StoredOutboxEntry {
  return {
    id: entry.id,
    operation: entry.operation,
    patch: entry.patch,
    queuedAt: entry.queuedAt,
    deviceId: entry.deviceId,
    attempts: entry.attempts,
    ...(entry.lastError === undefined ? {} : { lastError: entry.lastError }),
  };
}

function fromStored(row: StoredOutboxEntry): OutboxEntry {
  return {
    id: row.id as Ulid,
    operation: row.operation,
    patch: row.patch,
    queuedAt: row.queuedAt,
    deviceId: row.deviceId,
    attempts: row.attempts,
    ...(row.lastError === undefined ? {} : { lastError: row.lastError }),
  };
}
