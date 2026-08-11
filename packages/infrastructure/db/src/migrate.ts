import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

import { describeConnection } from "./client.js";

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

const MIGRATIONS_DIR = new URL("../migrations", import.meta.url).pathname;

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

export async function migrate(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const applied: string[] = [];

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

    const pending = pendingMigrations(readdirSync(MIGRATIONS_DIR), done);

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
  } finally {
    await sql.end();
  }

  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
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

  const applied = await migrate(url);
  console.log(
    applied.length === 0
      ? "Already up to date — nothing to apply."
      : `Applied ${applied.length}: ${applied.join(", ")}`,
  );
}
