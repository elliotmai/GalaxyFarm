import type { PgColumn } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";

import { allTables } from "../schema/index.js";
import type { RecordTable } from "../repositories/postgres-repository.js";

/**
 * Which entity names a patch may name.
 *
 * The entity in a patch is a string off the wire, so it is resolved against
 * this closed list rather than used to index anything. `allTables` includes the
 * two sync bookkeeping tables, and a patch naming one of those would be a
 * device writing its own audit log.
 */

const NOT_SYNCED = new Set(["syncAudit", "syncFieldMeta"]);

export const SYNCED_ENTITIES: readonly string[] = Object.keys(allTables).filter(
  (name) => !NOT_SYNCED.has(name),
);

export function tableFor(entity: string): RecordTable | undefined {
  if (!SYNCED_ENTITIES.includes(entity)) return undefined;
  return allTables[entity as keyof typeof allTables] as RecordTable;
}

export function columnsFor(table: RecordTable): Record<string, PgColumn> {
  return getTableColumns(table) as Record<string, PgColumn>;
}
