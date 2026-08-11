import type { PgColumn } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";

import { allTables } from "../schema/index.js";
import type { RecordTable } from "../repositories/postgres-repository.js";

/**
 * Which entity names a patch may name.
 *
 * The entity in a patch is a string off the wire, so it is resolved against
 * this closed list rather than used to index anything.
 */

/**
 * Tables that never sync, and why.
 *
 * Two kinds, and the second matters more than it looks:
 *
 * - **Bookkeeping.** `syncAudit` is the append-only change log and
 *   `syncFieldMeta` holds per-field write times. A patch naming either would
 *   be a device writing its own audit trail.
 * - **Credentials.** `users` carries a password hash and `kioskDevices`
 *   carries a device token hash. Sync copies rows to every device, and an
 *   IndexedDB store on a phone in a barn is not where either belongs — a lost
 *   phone would be a copy of every credential on the property. Users are
 *   administered through the server, not replicated to it.
 */
const NOT_SYNCED = new Set(["syncAudit", "syncFieldMeta", "users", "kioskDevices"]);

/** Tables that are not entities at all — no CRUD, no repository, no search. */
export const BOOKKEEPING_TABLES: readonly string[] = ["syncAudit", "syncFieldMeta"];

export const SYNCED_ENTITIES: readonly string[] = Object.keys(allTables).filter(
  (name) => !NOT_SYNCED.has(name),
);

/** Everything a repository exists for — everything except pure bookkeeping. */
export const REPOSITORY_TABLES: readonly string[] = Object.keys(allTables).filter(
  (name) => !BOOKKEEPING_TABLES.includes(name),
);

export function tableFor(entity: string): RecordTable | undefined {
  if (!SYNCED_ENTITIES.includes(entity)) return undefined;
  return allTables[entity as keyof typeof allTables] as RecordTable;
}

export function columnsFor(table: RecordTable): Record<string, PgColumn> {
  return getTableColumns(table) as Record<string, PgColumn>;
}
