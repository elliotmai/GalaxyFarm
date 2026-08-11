import { and, asc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import type { PgColumn, PgDatabase, PgQueryResultHKT, PgTable } from "drizzle-orm/pg-core";

import type { BaseRecord, ListQuery, Repository, Ulid } from "@galaxy-farm/core";

/**
 * The Postgres implementation of the repository port.
 *
 * One generic class rather than thirteen hand-written ones, because the thing
 * that must not vary between entities is exactly the part that would: what
 * `list` means. `repositoryConformanceCases` in the shared kernel runs against
 * this, against the IndexedDB store, and against the in-memory reference — and
 * a disagreement between the local store and the server store shows up as data
 * appearing on one device and not another, the hardest class of bug to notice
 * in this app.
 *
 * Nothing in the UI reads through this class. Screens read the local store and
 * the sync engine reconciles (§4.2), which is why Neon's scale-to-zero cold
 * start never lands in front of a person standing in a pen.
 */

/** Any table built from `baseColumns`. */
export type RecordTable = PgTable & {
  readonly id: PgColumn;
  readonly propertyId: PgColumn;
  readonly updatedAt: PgColumn;
  readonly deletedAt: PgColumn;
};

/** Satisfied by the postgres-js driver in production and PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT>;

/**
 * Escape the characters Postgres `LIKE` treats as wildcards.
 *
 * The in-memory and IndexedDB stores both search with `String.includes`, where
 * `%` is an ordinary character. Without this, a search for "50%" would match
 * everything on the server and one record on the phone — the contract says the
 * three stores agree, so the server has to be the one that gives ground.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class PostgresRepository<T extends BaseRecord> implements Repository<T> {
  private readonly columns: Record<string, PgColumn>;

  constructor(
    private readonly db: Database,
    private readonly table: RecordTable,
    /** Which text fields `ListQuery.search` looks at. */
    private readonly searchableFields: readonly (keyof T & string)[] = [],
  ) {
    this.columns = getTableColumns(table) as Record<string, PgColumn>;
  }

  async findById(id: Ulid): Promise<T | undefined> {
    const rows = await this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? undefined : this.toRecord(row);
  }

  async list(query: ListQuery): Promise<T[]> {
    let statement = this.db
      .select()
      .from(this.table)
      .where(this.conditions(query))
      // Collation is pinned to C so the order is byte order, which is what
      // `localeCompare` gives the other two stores. Left to the server's
      // locale, paging could differ between a developer's machine and Neon.
      .orderBy(asc(sql`${this.table.id} collate "C"`))
      .$dynamic();

    if (query.limit !== undefined) statement = statement.limit(query.limit);
    if (query.offset !== undefined) statement = statement.offset(query.offset);

    const rows = (await statement) as Record<string, unknown>[];
    return rows.map((row) => this.toRecord(row));
  }

  async count(query: ListQuery): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(this.table)
      .where(this.conditions(query));

    return rows[0]?.total ?? 0;
  }

  async save(record: T): Promise<void> {
    await this.saveMany([record]);
  }

  /**
   * Upsert. A sync push replays records the server may already hold — the same
   * patch arriving twice has to be a no-op, not a primary key violation, or a
   * retried push after a dropped connection would fail forever.
   */
  async saveMany(records: readonly T[]): Promise<void> {
    if (records.length === 0) return;

    await this.db
      .insert(this.table)
      .values(records.map((record) => this.toRow(record)))
      .onConflictDoUpdate({ target: this.table.id, set: this.upsertSet() });
  }

  async purge(id: Ulid): Promise<void> {
    await this.db.delete(this.table).where(eq(this.table.id, id));
  }

  private conditions(query: ListQuery): SQL | undefined {
    const conditions: SQL[] = [eq(this.table.propertyId, query.propertyId)];

    if (!(query.includeDeleted ?? false)) conditions.push(isNull(this.table.deletedAt));

    const search = query.search?.trim();
    if (search !== undefined && search !== "") conditions.push(this.searchCondition(search));

    return and(...conditions);
  }

  private searchCondition(search: string): SQL {
    const columns = this.searchableFields
      .map((field) => this.columns[field])
      .filter((column): column is PgColumn => column !== undefined);

    // An entity with nothing searchable matches nothing, which is what the
    // other two stores do — `[].some(...)` is false.
    if (columns.length === 0) return sql`false`;

    const pattern = `%${escapeLikePattern(search)}%`;
    return or(...columns.map((column) => sql`${column} ilike ${pattern}`)) as SQL;
  }

  /**
   * Entity to row.
   *
   * Driven by the table's columns rather than the record's keys: the table is
   * the statement of what is stored, and a stray field on the record — a
   * derived value, say — should not become a column that does not exist.
   */
  private toRow(record: T): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const key of Object.keys(this.columns)) {
      const value = (record as Record<string, unknown>)[key];
      row[key] = value === undefined ? null : value;
    }
    return row;
  }

  /**
   * Row to entity.
   *
   * `null` becomes an absent key, not `undefined`. `BaseRecord` states the
   * optional fields with `?`, and `restore()` deletes them outright — a record
   * read back from Postgres has to look like one that never left.
   */
  private toRecord(row: Record<string, unknown>): T {
    const record: Record<string, unknown> = {};
    for (const key of Object.keys(this.columns)) {
      const value = row[key];
      if (value !== null && value !== undefined) record[key] = value;
    }
    return record as T;
  }

  private upsertSet(): Record<string, SQL> {
    const set: Record<string, SQL> = {};
    for (const [key, column] of Object.entries(this.columns)) {
      // The id is the conflict target; everything else takes the incoming row.
      if (key === "id") continue;
      set[key] = sql.raw(`excluded."${column.name}"`);
    }
    return set;
  }
}
