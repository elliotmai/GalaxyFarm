import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import postgres from "postgres";

import { describeConnection } from "./client.js";
import {
  compareSchema,
  describeDrift,
  isDrifted,
  LIVE_COLUMNS_SQL,
  type LiveColumn,
  type SchemaDrift,
} from "./schema-drift.js";

/**
 * Apply pending migrations.
 *
 * Deliberately a plain SQL runner rather than drizzle-kit's `push`. `push`
 * diffs the schema and applies whatever it decides, which is fine on a laptop
 * and unacceptable against a database holding calving records. These are the
 * same numbered files that go into version control, applied in order, once
 * each, inside a transaction — and any Postgres will take them, which is what
 * §10's move to a box in the barn depends on.
 */

/**
 * Where the migration files are.
 *
 * `fileURLToPath`, not `.pathname`. A URL's pathname for
 * `file:///C:/GalaxyFarm/...` is `/C:/GalaxyFarm/...` — a leading slash in
 * front of a drive letter — and handing that to `readdirSync` produces
 * `C:\C:\GalaxyFarm\...`. The two functions agree on POSIX and disagree on
 * Windows, which is the whole family this file has now been caught by twice.
 */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Which migrations still need applying, in order.
 *
 * Pulled out of the runner because this is the part that can be wrong in a way
 * that matters — skipping a file, or replaying one — and the part that can be
 * tested without a database.
 */
export function pendingMigrations(
  files: readonly string[],
  applied: ReadonlySet<string>,
): string[] {
  return files
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => !applied.has(file));
}

/** Split a migration into the statements drizzle-kit marked as separable. */
export function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}

export interface MigrationOutcome {
  /** Files applied by this run. */
  readonly applied: readonly string[];
  /** Migration files found in this checkout. */
  readonly found: readonly string[];
  /**
   * What the schema is still missing afterwards.
   *
   * Checked because the ledger only knows about the files on *this* disk. A
   * checkout that predates a migration reports "already up to date" while the
   * database is behind the deployed code — which is exactly how a sync outage
   * survived a `pnpm db:migrate` that said everything was fine.
   */
  readonly drift: SchemaDrift;
}

export async function migrate(databaseUrl: string): Promise<MigrationOutcome> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  let found: string[] = [];
  let drift: SchemaDrift = { missingTables: [], missingColumns: [] };

  try {
    await sql`
      create table if not exists _migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const done = new Set(
      (await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name),
    );

    found = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const pending = pendingMigrations(found, done);

    for (const file of pending) {
      const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));

      // One transaction per migration: a half-applied schema is worse than an
      // unapplied one, because the next run cannot tell what state it is in.
      await sql.begin(async (tx) => {
        for (const statement of statements) await tx.unsafe(statement);
        await tx`insert into _migrations (name) values (${file})`;
      });

      applied.push(file);
    }

    const live = await sql<LiveColumn[]>`${sql.unsafe(LIVE_COLUMNS_SQL)}`;
    drift = compareSchema(live);
  } finally {
    await sql.end();
  }

  return { applied, found, drift };
}

/**
 * What to tell somebody after a run.
 *
 * Pulled out of the CLI block because that block is unreachable from a test —
 * and the sentence it prints is the whole value of the check. The case it
 * exists for: a checkout that predates a migration reports "already up to
 * date" while the database is short of what the deployed code selects, and the
 * only useful advice is `git pull`.
 */
export function migrationAdvice(outcome: MigrationOutcome): string | undefined {
  if (!isDrifted(outcome.drift)) return undefined;

  const explanation = describeDrift(outcome.drift) as string;

  return outcome.applied.length === 0
    ? `${explanation}\nNothing was applied and the schema is still short, so the missing ` +
        `migrations are not in this checkout (${outcome.found.length} found). ` +
        `Run \`git pull\` and try again.`
    : `${explanation}\nSome of what the code expects is still missing after applying. ` +
        `This checkout may be behind — run \`git pull\` and try again.`;
}

/**
 * Was this module run directly, or imported?
 *
 * Comparing `import.meta.url` to `file://${process.argv[1]}` by hand is wrong
 * on Windows and silently so: argv holds `C:\\GalaxyFarm\\...` while
 * `import.meta.url` is `file:///C:/GalaxyFarm/...`. They never match, the CLI
 * body never runs, and `pnpm db:migrate` exits successfully having applied
 * nothing — which is the worst possible way for a migration runner to fail.
 */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined || argv1 === "") return false;
  return moduleUrl === pathToFileURL(argv1).href;
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }

  const target = describeConnection(url);
  // Named, so nobody has to wonder afterwards which database this ran against
  // — and without the password the URL would otherwise put in the log.
  console.log(`Migrating ${target.database} at ${target.host}`);
  if (target.pooled) {
    console.warn(
      "This is the pooled (-pooler) endpoint. DDL belongs on the direct one; " +
        "use the connection string without '-pooler' in the host.",
    );
  }

  const { applied, found, drift } = await migrate(url);
  console.log(
    applied.length === 0
      ? `Already up to date — nothing to apply (${found.length} migrations in this checkout).`
      : `Applied ${applied.length}: ${applied.join(", ")}`,
  );

  // The ledger only knows about the files on *this* disk. A checkout that
  // predates a migration reports "already up to date" while the database is
  // behind the deployed code — which is how a sync outage survived a run of
  // this command that said everything was fine.
  const advice = migrationAdvice({ applied, found, drift });
  if (advice !== undefined) {
    console.error(`\n${advice}`);
    // Non-zero, so a deploy script or a CI step notices. A migration command
    // that exits 0 having left the schema short is the failure this whole
    // check exists to stop.
    process.exit(1);
  }
}
