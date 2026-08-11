import type { ListQuery } from "../crud/contracts.js";
import type { BaseRecord } from "../entities/record.js";
import type { Repository } from "../ports/index.js";
import type { Ulid } from "../types/ids.js";

/**
 * An in-memory implementation of the repository port.
 *
 * Its main job is to let use cases be tested with no infrastructure at all,
 * which is the whole point of the domain being pure. It is also the reference
 * the Postgres and IndexedDB implementations are checked against — all three
 * run the same conformance suite, so the two real stores cannot quietly drift
 * apart.
 */
export class InMemoryRepository<T extends BaseRecord> implements Repository<T> {
  private readonly records = new Map<string, T>();

  constructor(
    /** Which text fields `ListQuery.search` looks at. */
    private readonly searchableFields: readonly (keyof T)[] = [],
    seed: readonly T[] = [],
  ) {
    for (const record of seed) this.records.set(record.id, record);
  }

  async findById(id: Ulid): Promise<T | undefined> {
    return this.records.get(id);
  }

  async list(query: ListQuery): Promise<T[]> {
    const matched = this.matching(query);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? matched.length;
    return matched.slice(offset, offset + limit);
  }

  async count(query: ListQuery): Promise<number> {
    return this.matching(query).length;
  }

  async save(record: T): Promise<void> {
    this.records.set(record.id, record);
  }

  async saveMany(records: readonly T[]): Promise<void> {
    for (const record of records) this.records.set(record.id, record);
  }

  async purge(id: Ulid): Promise<void> {
    this.records.delete(id);
  }

  /** Test affordance — total rows including tombstones. */
  size(): number {
    return this.records.size;
  }

  private matching(query: ListQuery): T[] {
    const search = query.search?.trim().toLowerCase();

    return [...this.records.values()]
      .filter((record) => record.propertyId === query.propertyId)
      .filter((record) => (query.includeDeleted ?? false) || record.deletedAt === undefined)
      .filter((record) => {
        if (search === undefined || search === "") return true;
        return this.searchableFields.some((field) => {
          const value = record[field];
          return typeof value === "string" && value.toLowerCase().includes(search);
        });
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
