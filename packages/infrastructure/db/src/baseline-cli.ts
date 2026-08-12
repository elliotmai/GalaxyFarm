import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

import { describeBaseline, planBaseline } from "./baseline.js";
import { describeConnection } from "./client.js";
import { isEntryPoint, MIGRATIONS_DIR, pendingMigrations } from "./migrate.js";
import { LIVE_COLUMNS_SQL, type LiveColumn } from "./schema-drift.js";

/**
 * `pnpm db:baseline` — teach the ledger what the database already has.
 *
 * For the database that got its schema some other way and now meets the
 * numbered runner: the ledger is empty, so `db:migrate` starts at 0000, and
 * 0000 says `CREATE TABLE "animals"` against a database that already has one.
 *
 * This records — without running — every migration whose tables and columns
 * are already there, stopping at the first one that is not. It never adopts a
 * migration that is only half present. Run it once, then `db:migrate` picks up
 * from where this left off.
 */

export async function baselineLedger(databaseUrl: string): Promise<string> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  try {
    await sql`
      create table if not exists _migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const done = new Set(
      (await sql<{ name: string }[]>`select name from _migrations`).map((row) => row.name),
    );
    const pending = pendingMigrations(readdirSync(MIGRATIONS_DIR), done);
    const live = await sql<LiveColumn[]>`${sql.unsafe(LIVE_COLUMNS_SQL)}`;

    const plan = planBaseline(
      pending.map((file) => ({
        file,
        sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
      })),
      live,
    );

    // One statement, so a interruption cannot leave the ledger claiming half a
    // baseline. `on conflict do nothing` because a second run of this command
    // is a reasonable thing for somebody to do.
    for (const file of plan.adopt) {
      await sql`insert into _migrations (name) values (${file}) on conflict do nothing`;
    }

    return describeBaseline(plan);
  } finally {
    await sql.end();
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    console.error(
      "DATABASE_URL is not set.\n" +
        "  Locally: copy .env.example to .env.local and fill it in.\n" +
        "  In CI: set the DATABASE_URL secret on the repository.",
    );
    process.exit(1);
  }

  const target = describeConnection(url);
  console.log(`Baselining ${target.database} at ${target.host}\n`);
  if (target.pooled) {
    console.warn(
      "This is the pooled (-pooler) endpoint. Use the direct one — the host without '-pooler'.\n",
    );
  }

  console.log(await baselineLedger(url));
  console.log("\nNow run `pnpm db:migrate`.");
}
