import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import { describeDrift, isDrifted, schemaDrift } from "../src/schema-drift.js";
import { migrationAdvice } from "../src/migrate.js";
import { pullSince } from "../src/sync/pull.js";
import { SYNCED_ENTITIES } from "../src/sync/entities.js";
import type { Database } from "../src/repositories/postgres-repository.js";

/**
 * Drift between the code and the live database.
 *
 * Written after a real outage: migrations 0003 and 0004 were committed and
 * deployed but never run against the managed database, so the next sync pull
 * selected `properties.safety_level_labels`, got a bare 500, and the only
 * symptom was a red line in a browser console. Reads are local (§4.2), so
 * nothing else looked wrong — work simply stopped leaving the devices.
 */

const DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

function migrations(): string[] {
  return readdirSync(DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

async function apply(pg: PGlite, from: number, to: number): Promise<void> {
  for (const file of migrations().slice(from, to)) {
    for (const statement of readFileSync(join(DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await pg.exec(statement);
    }
  }
}

describe("schemaDrift", () => {
  it("reports nothing against a fully migrated database", async () => {
    const pg = new PGlite();
    await apply(pg, 0, migrations().length);

    const drift = await schemaDrift(drizzle(pg) as unknown as Database);

    expect(drift.missingTables).toEqual([]);
    expect(drift.missingColumns).toEqual([]);
    expect(isDrifted(drift)).toBe(false);
    expect(describeDrift(drift)).toBeUndefined();
  }, 60_000);

  it("names the tables and columns a database three migrations back is missing", async () => {
    // Exactly the production state: everything up to 0002, nothing after.
    const pg = new PGlite();
    await apply(pg, 0, 3);

    const drift = await schemaDrift(drizzle(pg) as unknown as Database);

    // Named individually rather than as a whole-set equality: the set grows
    // with every migration added after 0002, and a test that has to be edited
    // each time a table is created is one that eventually gets edited without
    // being read. What matters is that each of these is reported.
    for (const table of [
      "calendar_events",
      "cattle_profiles",
      "external_animals",
      "feeding_plans",
      "pasture_care_logs",
    ]) {
      expect(drift.missingTables).toContain(table);
    }

    // And the other half of accuracy: nothing that *is* there gets reported.
    // A drift check that cries wolf about existing tables is one people learn
    // to skip past, which is how the outage this test was written for happened.
    const live = await pg.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const present = new Set(live.rows.map((row) => row.table_name));
    expect(drift.missingTables.filter((table) => present.has(table))).toEqual([]);
    // Named individually for the same reason as the tables above: the set
    // grows with every column added after 0002.
    const missing = drift.missingColumns.map((entry) => `${entry.table}.${entry.column}`);
    for (const column of [
      "properties.safety_level_labels",
      "purchase_candidates.asking_price",
      "roadmap_items.budget_estimate",
    ]) {
      expect(missing).toContain(column);
    }

    // And no column that is actually there is reported missing.
    const liveColumns = await pg.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'",
    );
    const presentColumns = new Set(
      liveColumns.rows.map((row) => `${row.table_name}.${row.column_name}`),
    );
    expect(missing.filter((column) => presentColumns.has(column))).toEqual([]);
  }, 60_000);

  it("says what to do about it", async () => {
    // "Schema mismatch" sends somebody reading logs at ten at night looking in
    // the wrong place.
    const pg = new PGlite();
    await apply(pg, 0, 3);

    const explanation = describeDrift(await schemaDrift(drizzle(pg) as unknown as Database));

    expect(explanation).toMatch(/behind this deploy/);
    expect(explanation).toMatch(/pnpm db:migrate/);
    expect(explanation).toMatch(/pasture_care_logs/);
    expect(explanation).toMatch(/properties\.safety_level_labels/);
  }, 60_000);

  it("does not call an extra table drift", async () => {
    // A migration ahead of a rolled-back deploy is fine, and so is a table
    // somebody added by hand.
    const pg = new PGlite();
    await apply(pg, 0, migrations().length);
    await pg.exec("create table scratch (id text primary key)");

    expect(isDrifted(await schemaDrift(drizzle(pg) as unknown as Database))).toBe(false);
  }, 60_000);
});

describe("the failure it was written for", () => {
  it("a pull against a database three migrations back throws on the first table", async () => {
    const pg = new PGlite();
    await apply(pg, 0, 3);

    await expect(
      pullSince(drizzle(pg) as unknown as Database, {
        propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FP1" as never,
        cursors: {},
        entities: SYNCED_ENTITIES,
      }),
    ).rejects.toThrow(/safety_level_labels/);
  }, 60_000);

  it("and succeeds once the pending migrations are applied", async () => {
    const pg = new PGlite();
    await apply(pg, 0, 3);
    // With a row already in place, so a NOT NULL column added without a
    // default would fail here rather than against the real database.
    await pg.exec(
      `insert into properties (id, property_id, created_at, updated_at, name, timezone)
       values ('P1','P1', now(), now(), 'Flying Double M', 'America/Chicago')`,
    );

    await apply(pg, 3, migrations().length);

    await expect(
      pullSince(drizzle(pg) as unknown as Database, {
        propertyId: "P1" as never,
        cursors: {},
        entities: SYNCED_ENTITIES,
      }),
    ).resolves.toBeDefined();
  }, 60_000);
});

describe("migrationAdvice", () => {
  const drifted = {
    missingTables: ["feeding_plans"],
    missingColumns: [{ table: "properties", column: "safety_level_labels" }],
  };

  it("says nothing when the schema matches", () => {
    expect(
      migrationAdvice({
        applied: [],
        found: ["0000_initial_schema.sql"],
        drift: { missingTables: [], missingColumns: [] },
      }),
    ).toBeUndefined();
  });

  it("blames the checkout when nothing was applied and the schema is still short", () => {
    // The exact case that happened: `pnpm db:migrate` said "already up to
    // date" against a clone that did not yet contain 0003 and 0004, while the
    // deployed build was selecting columns they add.
    const advice = migrationAdvice({
      applied: [],
      found: ["0000_initial_schema.sql"],
      drift: drifted,
    });

    expect(advice).toMatch(/not in this checkout/);
    expect(advice).toMatch(/git pull/);
    expect(advice).toMatch(/feeding_plans/);
  });

  it("still warns when something was applied and the schema is short anyway", () => {
    const advice = migrationAdvice({
      applied: ["0003_pasture_feeding_calendar.sql"],
      found: ["0003_pasture_feeding_calendar.sql"],
      drift: drifted,
    });

    expect(advice).toMatch(/still missing after applying/);
    expect(advice).toMatch(/git pull/);
  });

  it("counts the migrations it found, so an empty directory cannot read as success", () => {
    // `pendingMigrations` over an empty list is an empty list, which the
    // runner would otherwise report as "already up to date".
    expect(migrationAdvice({ applied: [], found: [], drift: drifted })).toMatch(/\(0 found\)/);
  });
});
