import { getTableColumns, getTableName, sql } from "drizzle-orm";

import { allTables } from "./schema/index.js";
import type { Database } from "./repositories/postgres-repository.js";

/**
 * Is the database behind the code?
 *
 * This exists because of a real outage. A deploy added three tables and two
 * columns; the migrations were committed but never run against the managed
 * database, and the next sync pull selected `properties.safety_level_labels`
 * and got a bare 500. The app kept working — every read is local (§4.2) — so
 * the only symptom was sync silently failing, which is the worst shape of
 * failure this architecture can have: work piles up in an outbox that nobody
 * is told is not draining.
 *
 * Migrations are applied by hand on purpose (see `migrate.ts` — `push` against
 * a database holding calving records is not acceptable), so a gap between the
 * two is always possible. What was missing was any way to *say so*.
 */

export interface SchemaDrift {
  /** Tables the code expects that the database does not have. */
  readonly missingTables: readonly string[];
  /** Columns the code selects that the database does not have. */
  readonly missingColumns: readonly { readonly table: string; readonly column: string }[];
}

export function isDrifted(drift: SchemaDrift): boolean {
  return drift.missingTables.length > 0 || drift.missingColumns.length > 0;
}

/**
 * Compare the live schema to the one this build compiles against.
 *
 * Only reports things the database is *missing*. Extra tables and columns are
 * not drift: a migration that has run ahead of a rolled-back deploy is fine,
 * and so is anything somebody added by hand for their own reasons.
 */
export async function schemaDrift(db: Database): Promise<SchemaDrift> {
  const rows = (await db.execute(
    sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  )) as unknown as
    | { rows?: { table_name: string; column_name: string }[] }
    | { table_name: string; column_name: string }[];

  // postgres-js returns an array; PGlite returns { rows }. Both are legitimate
  // and neither is worth a second code path anywhere else.
  const live = Array.isArray(rows) ? rows : (rows.rows ?? []);

  const byTable = new Map<string, Set<string>>();
  for (const row of live) {
    const columns = byTable.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    byTable.set(row.table_name, columns);
  }

  const missingTables: string[] = [];
  const missingColumns: { table: string; column: string }[] = [];

  for (const table of Object.values(allTables)) {
    const name = getTableName(table);
    const present = byTable.get(name);

    if (present === undefined) {
      missingTables.push(name);
      continue;
    }

    for (const column of Object.values(getTableColumns(table))) {
      if (!present.has(column.name)) missingColumns.push({ table: name, column: column.name });
    }
  }

  return { missingTables, missingColumns };
}

/**
 * The drift, as a sentence somebody can act on.
 *
 * Names the fix, because "schema mismatch" sends a person reading logs at ten
 * at night looking in the wrong place.
 */
export function describeDrift(drift: SchemaDrift): string | undefined {
  if (!isDrifted(drift)) return undefined;

  const parts: string[] = [];
  if (drift.missingTables.length > 0) {
    parts.push(`missing tables: ${[...drift.missingTables].sort().join(", ")}`);
  }
  if (drift.missingColumns.length > 0) {
    parts.push(
      `missing columns: ${drift.missingColumns
        .map((entry) => `${entry.table}.${entry.column}`)
        .sort()
        .join(", ")}`,
    );
  }

  return (
    `The database is behind this deploy — ${parts.join("; ")}. ` +
    `Run \`pnpm db:migrate\` against it.`
  );
}
