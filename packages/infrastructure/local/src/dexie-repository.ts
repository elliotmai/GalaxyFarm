import { liveQuery } from "dexie";

import type {
  BaseRecord,
  ListQuery,
  ObservableRepository,
  Ulid,
  Unsubscribe,
} from "@galaxy-farm/core";

import type { FarmDatabase, StoredRecord } from "./database.js";

/**
 * A repository backed by IndexedDB.
 *
 * Holds to the same contract as the Postgres and in-memory implementations —
 * `repositoryConformanceCases` in the shared kernel runs against all three, so
 * the local store and the server store cannot disagree about what a list means.
 */
export class DexieRepository<T extends BaseRecord> implements ObservableRepository<T> {
  constructor(
    private readonly db: FarmDatabase,
    private readonly storeName: string,
    /** Which text fields `ListQuery.search` looks at. */
    private readonly searchableFields: readonly (keyof T)[] = [],
  ) {}

  async findById(id: Ulid): Promise<T | undefined> {
    return (await this.table().get(id)) as T | undefined;
  }

  async list(query: ListQuery): Promise<T[]> {
    const matched = await this.matching(query);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? matched.length;
    // The unpaged read is the one every screen makes, and it already owns the
    // array `matching` just built — slicing it only to hand back the same
    // rows copies the whole table on every keystroke and every sync write.
    if (offset === 0 && limit >= matched.length) return matched;
    return matched.slice(offset, offset + limit);
  }

  async count(query: ListQuery): Promise<number> {
    return (await this.matching(query)).length;
  }

  async save(record: T): Promise<void> {
    await this.table().put(record as unknown as StoredRecord);
  }

  async saveMany(records: readonly T[]): Promise<void> {
    if (records.length === 0) return;
    await this.table().bulkPut(records as unknown as StoredRecord[]);
  }

  async purge(id: Ulid): Promise<void> {
    await this.table().delete(id);
  }

  /**
   * Watch a query.
   *
   * Dexie's liveQuery re-runs the read whenever the underlying table changes,
   * whichever way the change arrived — a local write or a sync pull writing a
   * batch of pulled records. That is the property the Pen Board depends on.
   */
  observe(query: ListQuery, onChange: (records: T[]) => void): Unsubscribe {
    const subscription = liveQuery(() => this.list(query)).subscribe({
      next: onChange,
      // A failed read must not tear down the subscription — the screen keeps
      // its last good data and the next change re-runs the query.
      error: () => {},
    });
    return () => subscription.unsubscribe();
  }

  observeById(id: Ulid, onChange: (record: T | undefined) => void): Unsubscribe {
    const subscription = liveQuery(() => this.findById(id)).subscribe({
      next: onChange,
      error: () => {},
    });
    return () => subscription.unsubscribe();
  }

  private table() {
    return this.db.records<StoredRecord>(this.storeName);
  }

  private async matching(query: ListQuery): Promise<T[]> {
    // Index on propertyId does the coarse filter; the rest is in memory. At
    // this scale — a few thousand records per entity at most — that is faster
    // than a compound index and far easier to keep correct.
    const rows = (await this.table().where("propertyId").equals(query.propertyId).toArray()) as T[];
    const search = query.search?.trim().toLowerCase();
    const includeDeleted = query.includeDeleted ?? false;
    const searching = search !== undefined && search !== "";

    // One pass rather than three. The old chain built two intermediate arrays
    // per read, and a read happens on every keystroke in a search box and on
    // every write a sync pull makes — so the garbage it produced was measured
    // in copies of the whole table, not in copies of the result.
    const matched: T[] = [];
    for (const row of rows) {
      if (!includeDeleted && row.deletedAt !== undefined) continue;
      if (searching && !this.matchesSearch(row, search)) continue;
      matched.push(row);
    }

    return matched.sort(byId);
  }

  private matchesSearch(row: T, search: string): boolean {
    for (const field of this.searchableFields) {
      const value = row[field];
      if (typeof value === "string" && value.toLowerCase().includes(search)) return true;
    }
    return false;
  }
}

/**
 * Order by id, byte for byte.
 *
 * Not `localeCompare`. That runs the full Unicode collation algorithm — on a
 * herd-sized table it is the single most expensive thing in a read, and every
 * read re-sorts, because a `liveQuery` re-runs the whole query whenever the
 * table changes. Ids here are ULIDs: Crockford base32, uppercase, fixed
 * length, so code-unit order and collation order are the same order.
 *
 * It also makes this implementation agree with the other two rather than
 * disagree with them. `postgres-repository.ts` orders by `id collate "C"` —
 * byte order — and the conformance suite runs the same cases against both, so
 * the locale-aware comparator was the odd one out.
 */
function byId(left: BaseRecord, right: BaseRecord): number {
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}
