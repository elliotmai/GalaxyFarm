import type { ListQuery, Repository, BaseRecord, Ulid } from "@galaxy-farm/core";

import type { FarmDatabase, StoredRecord } from "./database.js";

/**
 * A repository backed by IndexedDB.
 *
 * Holds to the same contract as the Postgres and in-memory implementations —
 * `repositoryConformanceCases` in the shared kernel runs against all three, so
 * the local store and the server store cannot disagree about what a list means.
 */
export class DexieRepository<T extends BaseRecord> implements Repository<T> {
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

  private table() {
    return this.db.records<StoredRecord>(this.storeName);
  }

  private async matching(query: ListQuery): Promise<T[]> {
    // Index on propertyId does the coarse filter; the rest is in memory. At
    // this scale — a few thousand records per entity at most — that is faster
    // than a compound index and far easier to keep correct.
    const rows = (await this.table().where("propertyId").equals(query.propertyId).toArray()) as T[];
    const search = query.search?.trim().toLowerCase();

    return rows
      .filter((row) => (query.includeDeleted ?? false) || row.deletedAt === undefined)
      .filter((row) => {
        if (search === undefined || search === "") return true;
        return this.searchableFields.some((field) => {
          const value = row[field];
          return typeof value === "string" && value.toLowerCase().includes(search);
        });
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
