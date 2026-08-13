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

  it("backfills covers onto the auto-refill tanks and leaves the static one alone", async () => {
    /*
     * A data migration, unlike a schema one, can be wrong in a way nothing
     * else notices: it runs, it succeeds, and it updates the wrong rows or no
     * rows at all. So this applies everything up to the backfill, puts a tank
     * of each type in the way, and then lets the backfill run over them.
     *
     * The `updated_at` assertion is the one that matters most. The sync cursor
     * is `(updated_at, id)`, so a value changed underneath a row whose
     * timestamp did not move is a value correct on the server and wrong on
     * every device — and no pull would ever fetch it.
     */
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const backfill = files.find((f) => f.includes("tank_covers_backfill"))!;
    const before = files.slice(0, files.indexOf(backfill));

    await db.exec(`create table _migrations (name text primary key, applied_at timestamptz)`);
    for (const file of before) {
      for (const statement of splitStatements(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))) {
        await db.exec(statement);
      }
      await db.query(`insert into _migrations (name) values ($1)`, [file]);
    }

    const stamped = "2026-01-01T00:00:00Z";
    for (const [id, type, deletedAt] of [
      ["auto-1", "auto_refill", null],
      ["static-1", "static_tank", null],
      ["auto-deleted", "auto_refill", stamped],
    ] as const) {
      await db.query(
        `insert into water_sources
           (id, property_id, created_at, updated_at, deleted_at, name, type, has_heater, active)
         values ($1, 'p1', $2, $2, $3, $1, $4, false, true)`,
        [id, stamped, deletedAt, type],
      );
    }

    await runMigrations(db);

    const rows = await db.query<{ id: string; cover: string; updated_at: Date }>(
      `select id, cover, updated_at from water_sources order by id`,
    );
    const by = (id: string) => rows.rows.find((row) => row.id === id)!;

    expect(by("auto-1").cover).toBe("off");
    // Moved, or no device will ever hear about it.
    expect(by("auto-1").updated_at.getTime()).toBeGreaterThan(new Date(stamped).getTime());

    // Nothing to put on, so nothing claimed. This is the tank the cover list
    // must never name.
    expect(by("static-1").cover).toBe("none");
    expect(by("static-1").updated_at.getTime()).toBe(new Date(stamped).getTime());

    // A tombstone re-sent to every device is noise for a field nothing reads.
    expect(by("auto-deleted").cover).toBe("none");
    expect(by("auto-deleted").updated_at.getTime()).toBe(new Date(stamped).getTime());
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
