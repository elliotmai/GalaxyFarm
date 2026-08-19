import { isStuck, type PhotoQueue, type QueuedPhoto, type Ulid } from "@galaxy-farm/core";

import { UPLOADS_STORE, type FarmDatabase, type StoredRecord } from "./database.js";

/**
 * The photo queue, persisted to IndexedDB (spec §4.2).
 *
 * This is the half of the promise that the `Attachment` record cannot keep on
 * its own. The record syncs the moment there is signal and says a photograph
 * exists; these are the bytes, and if they lived in memory they would be gone
 * the first time the phone went in a pocket and the browser was evicted —
 * leaving a record pointing at a key with nothing behind it, which renders as
 * a broken tile forever rather than as a photo that has not arrived yet.
 *
 * `attempts` counts refusals, never outages, exactly as the outbox does: a
 * server that was down is not a verdict on a photograph.
 */

// Declared in `database.ts` so the table is created unconditionally —
// re-exported here because this is where callers look for it.
export { UPLOADS_STORE, UPLOADS_INDEXES, UPLOADS_SCHEMA_VERSION } from "./database.js";

/** Dexie stores plain data, so the entry is flattened on the way in. */
interface StoredPhoto extends Record<string, unknown> {
  readonly id: string;
  readonly propertyId: string;
  readonly ownerEntity: string;
  readonly ownerId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly queuedAt: Date;
  readonly attempts: number;
  readonly lastError?: string;
}

export class DexiePhotoQueue implements PhotoQueue {
  constructor(private readonly db: FarmDatabase) {}

  async append(photo: QueuedPhoto): Promise<void> {
    // put, not add — a photo re-queued after an ambiguous failure must replace
    // its entry rather than upload the same bytes twice.
    await this.table().put(toStored(photo) as unknown as StoredRecord);
  }

  async pending(limit?: number): Promise<QueuedPhoto[]> {
    // ULIDs sort by creation time, so the primary key orders the queue by the
    // moment each photograph was taken, with no sequence column.
    const rows = (await this.table().orderBy("id").toArray()) as unknown as StoredPhoto[];
    const photos = rows.map(fromStored);
    return limit === undefined ? photos : photos.slice(0, limit);
  }

  async settle(ids: readonly Ulid[]): Promise<void> {
    if (ids.length === 0) return;
    await this.table().bulkDelete([...ids]);
  }

  async fail(id: Ulid, error: string): Promise<void> {
    const existing = (await this.table().get(id)) as unknown as StoredPhoto | undefined;
    if (existing === undefined) return;

    await this.table().put({
      ...existing,
      attempts: existing.attempts + 1,
      lastError: error,
    } as unknown as StoredRecord);
  }

  async defer(id: Ulid, error: string): Promise<void> {
    const existing = (await this.table().get(id)) as unknown as StoredPhoto | undefined;
    if (existing === undefined) return;

    await this.table().put({ ...existing, lastError: error } as unknown as StoredRecord);
  }

  async size(): Promise<number> {
    return this.table().count();
  }

  async stuck(): Promise<QueuedPhoto[]> {
    const rows = (await this.table().toArray()) as unknown as StoredPhoto[];
    return rows.map(fromStored).filter(isStuck);
  }

  async revive(ids: readonly Ulid[]): Promise<void> {
    for (const id of ids) {
      const existing = (await this.table().get(id)) as unknown as StoredPhoto | undefined;
      if (existing === undefined) continue;
      await this.table().put({ ...existing, attempts: 0 } as unknown as StoredRecord);
    }
  }

  private table() {
    return this.db.records<StoredRecord>(UPLOADS_STORE);
  }
}

function toStored(photo: QueuedPhoto): StoredPhoto {
  return {
    id: photo.id,
    propertyId: photo.propertyId,
    ownerEntity: photo.ownerEntity,
    ownerId: photo.ownerId,
    filename: photo.filename,
    contentType: photo.contentType,
    body: photo.body,
    queuedAt: photo.queuedAt,
    attempts: photo.attempts,
    ...(photo.lastError === undefined ? {} : { lastError: photo.lastError }),
  };
}

function fromStored(row: StoredPhoto): QueuedPhoto {
  return {
    id: row.id as Ulid,
    propertyId: row.propertyId as Ulid,
    ownerEntity: row.ownerEntity,
    ownerId: row.ownerId as Ulid,
    filename: row.filename,
    contentType: row.contentType,
    // Structured clone hands back a plain view; the length is what every
    // caller uses, so it is normalised here rather than at each of them.
    body: new Uint8Array(row.body),
    queuedAt: row.queuedAt,
    attempts: row.attempts,
    ...(row.lastError === undefined ? {} : { lastError: row.lastError }),
  };
}
