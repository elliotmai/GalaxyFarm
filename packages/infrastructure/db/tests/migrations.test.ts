import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The migrations, applied to a real Postgres.
 *
 * PGlite is PostgreSQL 18 compiled to WASM, running in-process — so this is not
 * a mock or a SQL parser, it is the same engine that will reject a bad type or
 * a duplicate index name in production. The managed database is unreachable
 * from CI, and shipping a schema nobody ever executed would be worse than
 * having no schema at all.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function applyAll(db: PGlite): Promise<void> {
  for (const file of migrationFiles()) {
    const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    for (const statement of statements) await db.exec(statement);
  }
}

describe("migrations", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyAll(db);
  }, 60_000);

  it("applies cleanly to an empty database", async () => {
    const tables = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );

    expect(tables.rows.map((r) => r.tablename)).toEqual([
      "animals",
      "attachments",
      "branding_configs",
      "chore_templates",
      "contacts",
      "properties",
      "purchase_candidates",
      "roadmap_items",
      "sync_audit",
      "sync_field_meta",
      "tasks",
      "water_sources",
      "zone_assignments",
      "zones",
    ]);
  });

  it("gives every table the base columns §5 requires", async () => {
    // A table that forgets propertyId makes a second location a migration
    // rather than a query filter; one that forgets the tombstone columns
    // silently opts out of §4.5 clause 4.
    const rows = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'
         and column_name in ('id','property_id','created_at','updated_at','deleted_at','deleted_by')`,
    );

    const byTable = new Map<string, Set<string>>();
    for (const row of rows.rows) {
      byTable.set(row.table_name, (byTable.get(row.table_name) ?? new Set()).add(row.column_name));
    }

    for (const [table, columns] of byTable) {
      // Sync bookkeeping, not entities: append-only change log and per-field
      // write times. Neither is a Repository and neither carries a tombstone.
      if (table === "sync_audit" || table === "sync_field_meta") continue;
      for (const required of ["id", "property_id", "created_at", "updated_at", "deleted_at"]) {
        expect(columns.has(required), `${table} is missing ${required}`).toBe(true);
      }
    }
  });

  it("indexes the sync cursor on every table", async () => {
    // §4.2 pulls by updatedAt per entity. Without the index every pull is a
    // sequential scan, and it degrades as history accumulates.
    const rows = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and indexname like '%_sync_cursor_idx'`,
    );

    expect(rows.rows.length).toBe(12);
  });

  it("has a partial index keeping the default read path off deleted history", async () => {
    const rows = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname like '%_live_idx'`,
    );

    expect(rows.rows.length).toBe(12);
    expect(rows.rows.every((r) => r.indexdef.includes("deleted_at IS NULL"))).toBe(true);
  });

  it("is idempotent — running it twice would fail loudly, not silently", async () => {
    // The runner tracks applied files, but if it ever did not, re-applying
    // must error rather than quietly half-succeed.
    await expect(applyAll(db)).rejects.toThrow();
  });

  it("uses no extensions, so any Postgres can take it", async () => {
    // §10: the move to a box in the barn is pg_dump | pg_restore. An extension
    // is exactly the thing that would break that.
    const sql = migrationFiles()
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");

    expect(sql).not.toMatch(/CREATE EXTENSION/i);
    expect(sql).not.toMatch(/vector|postgis|timescale/i);
  });

  it("stores money as integer cents, never floating point", async () => {
    // Floating-point dollars drift, and these columns add up into a per-animal
    // P&L someone makes decisions on.
    const rows = await db.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and column_name like '%_cents'`,
    );

    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((r) => r.data_type === "integer")).toBe(true);
  });

  it("keeps timestamps timezone-aware", async () => {
    // A barn at 6am in November and a server in UTC disagree about what day it
    // is; a naive timestamp makes that disagreement invisible.
    const rows = await db.query<{ data_type: string }>(
      `select data_type from information_schema.columns
       where table_schema = 'public' and data_type like 'timestamp%'`,
    );

    expect(rows.rows.every((r) => r.data_type === "timestamp with time zone")).toBe(true);
  });
});
