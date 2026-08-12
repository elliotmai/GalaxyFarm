import type { LiveColumn } from "./schema-drift.js";

/**
 * Adopting a database that already has the tables (spec §10).
 *
 * The situation this exists for is real and will happen again. A database gets
 * its schema some other way — `drizzle-kit push` early on, a restore from a
 * dump, a hand-run file — and then the numbered runner is pointed at it. The
 * ledger is empty, so the runner starts at 0000, and 0000 says
 * `CREATE TABLE "animals"`, and Postgres says `relation "animals" already
 * exists`. Nothing is broken; the ledger simply does not know what the
 * database already has.
 *
 * The wrong fixes are both tempting. Adding `IF NOT EXISTS` everywhere would
 * make the runner silently skip a table it *should* have created and leave a
 * schema that is subtly wrong forever. Inserting every filename into the
 * ledger by hand would claim migrations are applied without checking, which is
 * the same lie written faster.
 *
 * So: read what each migration would create, check the database already has
 * exactly that, and only then record it as applied. A migration whose objects
 * are *partly* present is not baselined — it is left pending, and left to a
 * person, because a half-present migration is a question rather than a state.
 */

export interface MigrationObjects {
  /** Tables this migration creates. */
  readonly tables: readonly string[];
  /** Columns it adds to tables that already exist. */
  readonly columns: readonly { readonly table: string; readonly column: string }[];
}

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi;
const ADD_COLUMN =
  /alter\s+table\s+"?([a-z0-9_]+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi;

/**
 * What a migration file creates.
 *
 * Tables and added columns only. Indexes, constraints and data changes are
 * deliberately ignored: an index is cheap to have twice and impossible to
 * detect reliably from the SQL, and a migration that only touches those is one
 * a person should decide about rather than one this should quietly adopt.
 */
export function migrationObjects(sql: string): MigrationObjects {
  const tables = [...sql.matchAll(CREATE_TABLE)].map((match) => (match[1] ?? "").toLowerCase());
  const columns = [...sql.matchAll(ADD_COLUMN)].map((match) => ({
    table: (match[1] ?? "").toLowerCase(),
    column: (match[2] ?? "").toLowerCase(),
  }));

  return { tables, columns };
}

export type BaselineVerdict =
  | { readonly kind: "already_there"; readonly detail: string }
  | { readonly kind: "must_run"; readonly detail: string }
  | { readonly kind: "partly_there"; readonly detail: string };

/**
 * Is this migration's work already done?
 *
 * Three answers, and the third is the important one. Everything present means
 * the migration can be recorded without running. Nothing present means it has
 * to run. **Some** present means somebody has to look: a table that exists
 * without the column the same migration adds is a database in a state this
 * cannot reason about, and guessing either way risks a schema that no
 * migration file describes.
 */
export function baselineVerdict(
  objects: MigrationObjects,
  live: readonly LiveColumn[],
): BaselineVerdict {
  if (objects.tables.length === 0 && objects.columns.length === 0) {
    return {
      kind: "must_run",
      detail: "creates no tables or columns, so there is nothing to check for",
    };
  }

  const byTable = new Map<string, Set<string>>();
  for (const row of live) {
    const columns = byTable.get(row.table_name.toLowerCase()) ?? new Set<string>();
    columns.add(row.column_name.toLowerCase());
    byTable.set(row.table_name.toLowerCase(), columns);
  }

  const tablesPresent = objects.tables.filter((table) => byTable.has(table));
  const columnsPresent = objects.columns.filter((entry) =>
    byTable.get(entry.table)?.has(entry.column),
  );

  const total = objects.tables.length + objects.columns.length;
  const present = tablesPresent.length + columnsPresent.length;

  if (present === total) {
    return {
      kind: "already_there",
      detail:
        [
          tablesPresent.length === 0 ? undefined : `${tablesPresent.length} table(s)`,
          columnsPresent.length === 0 ? undefined : `${columnsPresent.length} column(s)`,
        ]
          .filter((part) => part !== undefined)
          .join(" and ") + " already present",
    };
  }

  if (present === 0) {
    return { kind: "must_run", detail: "none of what it creates is there yet" };
  }

  const missingTables = objects.tables.filter((table) => !byTable.has(table));
  const missingColumns = objects.columns.filter(
    (entry) => !byTable.get(entry.table)?.has(entry.column),
  );

  return {
    kind: "partly_there",
    detail: `${present} of ${total} already present — missing ${[
      ...missingTables,
      ...missingColumns.map((entry) => `${entry.table}.${entry.column}`),
    ].join(", ")}`,
  };
}

export interface BaselinePlan {
  /** Recorded as applied without being run. */
  readonly adopt: readonly string[];
  /** Left pending; the runner will apply these next time. */
  readonly run: readonly string[];
  /** Nothing safe to decide. Reported, and the command stops. */
  readonly ambiguous: readonly { readonly file: string; readonly detail: string }[];
}

/**
 * What to do with each pending migration, given what the database has.
 *
 * Order matters and is preserved: a plan that adopted 0003 while leaving 0001
 * to run would record a lie, because the ledger is a sequence and not a set.
 * So the first migration that has to run ends the adoption — everything from
 * there on runs, whether or not its objects happen to be present.
 */
export function planBaseline(
  files: readonly { readonly file: string; readonly sql: string }[],
  live: readonly LiveColumn[],
): BaselinePlan {
  const adopt: string[] = [];
  const run: string[] = [];
  const ambiguous: { file: string; detail: string }[] = [];
  let stillAdopting = true;

  for (const entry of files) {
    if (!stillAdopting) {
      run.push(entry.file);
      continue;
    }

    const verdict = baselineVerdict(migrationObjects(entry.sql), live);

    if (verdict.kind === "already_there") {
      adopt.push(entry.file);
      continue;
    }
    if (verdict.kind === "partly_there") {
      ambiguous.push({ file: entry.file, detail: verdict.detail });
      stillAdopting = false;
      continue;
    }

    stillAdopting = false;
    run.push(entry.file);
  }

  return { adopt, run, ambiguous };
}

/** What to print. Separated from the CLI so it can be tested. */
export function describeBaseline(plan: BaselinePlan): string {
  const lines: string[] = [];

  if (plan.adopt.length > 0) {
    lines.push(
      `Already in the database — recording as applied without running:\n  ${plan.adopt.join("\n  ")}`,
    );
  }
  if (plan.run.length > 0) {
    lines.push(`Still to apply — run \`pnpm db:migrate\`:\n  ${plan.run.join("\n  ")}`);
  }
  if (plan.ambiguous.length > 0) {
    lines.push(
      "Stopped here. These are half-applied, which is a state nothing can safely " +
        "decide about:\n  " +
        plan.ambiguous.map((entry) => `${entry.file} — ${entry.detail}`).join("\n  "),
    );
  }
  if (lines.length === 0) lines.push("Nothing pending.");

  return lines.join("\n\n");
}
