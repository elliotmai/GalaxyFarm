import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pendingMigrations, splitStatements } from "../src/migrate.js";

/**
 * The runner's actual loop, against a real Postgres.
 *
 * `migrate()` itself takes a connection string and opens a postgres.js
 * connection, which PGlite is not — so what runs here is the same sequence
 * against the same engine: create the ledger, read what has been applied, and
 * apply what has not, once each, in order.
 *
 * This exists because the runner failed in the field in the quietest possible
 * way — an entry-point check that was wrong on Windows meant `pnpm db:migrate`
 * exited 0 having done nothing at all. `isEntryPoint` is tested directly; this
 * covers the half after it.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
});

afterEach(async () => {
  await db.close();
});

/** The body of `migrate()`, against whatever client is handed in. */
async function runMigrations(client: PGlite): Promise<string[]> {
  await client.exec(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const done = new Set(
    (await client.query<{ name: string }>(`select name from _migrations`)).rows.map((r) => r.name),
  );
  const pending = pendingMigrations(readdirSync(MIGRATIONS_DIR), done);
  const applied: string[] = [];

  for (const file of pending) {
    for (const statement of splitStatements(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))) {
      await client.exec(statement);
    }
    await client.query(`insert into _migrations (name) values ($1)`, [file]);
    applied.push(file);
  }

  return applied;
}

describe("the migration loop", () => {
  it("applies every migration to an empty database", async () => {
    const applied = await runMigrations(db);

    expect(applied.length).toBeGreaterThanOrEqual(3);
    expect(applied[0]).toMatch(/^0000_/);

    const tables = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    expect(tables.rows.map((r) => r.tablename)).toContain("users");
  }, 60_000);

  it("applies them in numbered order, not in whatever order the disk gives", async () => {
    const applied = await runMigrations(db);

    expect([...applied].sort()).toEqual(applied);
  }, 60_000);

  it("does nothing on a second run", async () => {
    // The property that makes it safe to run against a database holding real
    // records: applied once each, ever.
    await runMigrations(db);
    const second = await runMigrations(db);

    expect(second).toEqual([]);
  }, 60_000);

  it("records what it applied, so the next run can tell", async () => {
    await runMigrations(db);

    const ledger = await db.query<{ name: string }>(`select name from _migrations order by name`);
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

    expect(ledger.rows.map((r) => r.name)).toEqual([...files].sort());
  }, 60_000);

  it("applies only what is missing when the ledger is partial", async () => {
    // The realistic case: a database that took the first migration months ago
    // and has never seen the ones added since.
    await db.exec(`create table _migrations (name text primary key, applied_at timestamptz)`);
    const first = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()[0]!;
    for (const statement of splitStatements(readFileSync(join(MIGRATIONS_DIR, first), "utf8"))) {
      await db.exec(statement);
    }
    await db.query(`insert into _migrations (name) values ($1)`, [first]);

    const applied = await runMigrations(db);

    expect(applied).not.toContain(first);
    expect(applied.length).toBeGreaterThan(0);
  }, 60_000);
});
