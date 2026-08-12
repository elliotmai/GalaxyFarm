import { describe, expect, it } from "vitest";

import {
  baselineVerdict,
  describeBaseline,
  migrationObjects,
  planBaseline,
} from "../src/baseline.js";
import { describeMigrationFailure } from "../src/migrate.js";
import type { LiveColumn } from "../src/schema-drift.js";

/**
 * Adopting a database that already has the schema (§10).
 *
 * The failure this exists for is real: `relation "animals" already exists` on
 * migration 0000, against a Neon database that had been given its schema some
 * other way. Nothing was broken — the ledger was simply empty.
 *
 * What has to hold is that adoption is *checked* rather than assumed. Marking
 * a migration applied without confirming its objects are there is the same
 * lie as `IF NOT EXISTS`, written faster.
 */

const columns = (spec: Record<string, readonly string[]>): LiveColumn[] =>
  Object.entries(spec).flatMap(([table, names]) =>
    names.map((column) => ({ table_name: table, column_name: column })),
  );

describe("what a migration creates", () => {
  it("finds the tables", () => {
    const objects = migrationObjects(
      `CREATE TABLE "animals" ("id" text);--> statement-breakpoint\nCREATE TABLE "zones" ("id" text);`,
    );

    expect(objects.tables).toEqual(["animals", "zones"]);
  });

  it("finds added columns with the table they belong to", () => {
    const objects = migrationObjects(`ALTER TABLE "animals" ADD COLUMN "died_on" timestamp;`);

    expect(objects.columns).toEqual([{ table: "animals", column: "died_on" }]);
  });

  it("reads IF NOT EXISTS the same as a plain create", () => {
    expect(migrationObjects(`CREATE TABLE IF NOT EXISTS "feed_types" ()`).tables).toEqual([
      "feed_types",
    ]);
  });

  it("ignores indexes, which are not what adoption turns on", () => {
    const objects = migrationObjects(`CREATE INDEX "animals_property_idx" ON "animals" ("x");`);

    expect(objects.tables).toEqual([]);
    expect(objects.columns).toEqual([]);
  });
});

describe("is it already there", () => {
  it("adopts a migration whose tables all exist", () => {
    const verdict = baselineVerdict(
      { tables: ["animals"], columns: [] },
      columns({ animals: ["id", "name"] }),
    );

    expect(verdict.kind).toBe("already_there");
  });

  it("runs a migration whose tables do not exist", () => {
    const verdict = baselineVerdict({ tables: ["fertility_tests"], columns: [] }, columns({}));

    expect(verdict.kind).toBe("must_run");
  });

  it("refuses to decide about a half-applied migration", () => {
    // A table present without the column the same migration adds is a state
    // nothing can safely reason about. Adopting would hide a missing column
    // forever; running would fail on the table. A person has to look.
    const verdict = baselineVerdict(
      {
        tables: ["fertility_tests"],
        columns: [{ table: "animals", column: "died_on" }],
      },
      columns({ fertility_tests: ["id"], animals: ["id"] }),
    );

    expect(verdict.kind).toBe("partly_there");
    expect(verdict.detail).toMatch(/animals\.died_on/);
  });

  it("runs a migration that creates nothing it can check for", () => {
    // Data changes and index-only migrations are not adoptable: there is
    // nothing to look for, so "everything is present" would be vacuously true.
    expect(baselineVerdict({ tables: [], columns: [] }, columns({})).kind).toBe("must_run");
  });

  it("matches a table name whatever case the SQL used", () => {
    expect(
      baselineVerdict({ tables: ["animals"], columns: [] }, [
        { table_name: "ANIMALS", column_name: "ID" },
      ]).kind,
    ).toBe("already_there");
  });
});

describe("the plan", () => {
  const live = columns({ animals: ["id"], zones: ["id"] });

  it("adopts the leading run and leaves the rest to apply", () => {
    const plan = planBaseline(
      [
        { file: "0000_initial.sql", sql: `CREATE TABLE "animals" ()` },
        { file: "0001_zones.sql", sql: `CREATE TABLE "zones" ()` },
        { file: "0002_health.sql", sql: `CREATE TABLE "health_records" ()` },
      ],
      live,
    );

    expect(plan.adopt).toEqual(["0000_initial.sql", "0001_zones.sql"]);
    expect(plan.run).toEqual(["0002_health.sql"]);
  });

  it("stops adopting at the first gap, whatever comes after it", () => {
    // The ledger is a sequence, not a set. Adopting 0002 while 0001 is pending
    // would record a lie that no later run could detect.
    const plan = planBaseline(
      [
        { file: "0000_initial.sql", sql: `CREATE TABLE "animals" ()` },
        { file: "0001_missing.sql", sql: `CREATE TABLE "health_records" ()` },
        { file: "0002_present.sql", sql: `CREATE TABLE "zones" ()` },
      ],
      live,
    );

    expect(plan.adopt).toEqual(["0000_initial.sql"]);
    expect(plan.run).toEqual(["0001_missing.sql", "0002_present.sql"]);
  });

  it("stops dead on an ambiguous one rather than guessing past it", () => {
    const plan = planBaseline(
      [
        {
          file: "0000_half.sql",
          sql: `CREATE TABLE "animals" ();--> statement-breakpoint\nALTER TABLE "animals" ADD COLUMN "died_on" text;`,
        },
        { file: "0001_after.sql", sql: `CREATE TABLE "zones" ()` },
      ],
      live,
    );

    expect(plan.adopt).toEqual([]);
    expect(plan.ambiguous.map((entry) => entry.file)).toEqual(["0000_half.sql"]);
    expect(plan.run).toEqual(["0001_after.sql"]);
  });

  it("says nothing pending when there is nothing pending", () => {
    expect(describeBaseline(planBaseline([], live))).toBe("Nothing pending.");
  });

  it("names the files rather than counting them", () => {
    const text = describeBaseline(
      planBaseline([{ file: "0000_initial.sql", sql: `CREATE TABLE "animals" ()` }], live),
    );

    expect(text).toContain("0000_initial.sql");
  });
});

describe("what a failed migration says", () => {
  it("recognises a duplicate table and names the command that fixes it", () => {
    // The default is a Postgres stack trace ending in
    // `heap_create_with_catalog`, which tells nobody what to do next.
    const message = describeMigrationFailure("0000_initial_schema.sql", {
      code: "42P07",
      message: 'relation "animals" already exists',
    });

    expect(message).toMatch(/db:baseline/);
    expect(message).toMatch(/nothing needs deleting/i);
  });

  it("recognises a duplicate column too", () => {
    expect(describeMigrationFailure("0013.sql", { code: "42701", message: "x" })).toMatch(
      /db:baseline/,
    );
  });

  it("does not offer baselining for a failure baselining cannot fix", () => {
    const message = describeMigrationFailure("0009.sql", {
      code: "42703",
      message: 'column "gone" does not exist',
    });

    expect(message).not.toMatch(/db:baseline/);
    expect(message).toMatch(/0009\.sql failed/);
  });
});
