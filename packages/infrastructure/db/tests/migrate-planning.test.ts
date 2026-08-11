import { describe, expect, it } from "vitest";

import { pendingMigrations, splitStatements } from "../src/migrate.js";

/**
 * The decidable half of the migration runner.
 *
 * Skipping a migration or replaying one are the two failure modes that would
 * quietly corrupt a schema, and both are decided here — where they can be
 * tested without a live server.
 */

describe("pendingMigrations", () => {
  it("returns everything when nothing has been applied", () => {
    const files = ["0001_b.sql", "0000_a.sql"];

    expect(pendingMigrations(files, new Set())).toEqual(["0000_a.sql", "0001_b.sql"]);
  });

  it("applies in numeric order regardless of directory order", () => {
    // A migration applied out of order can reference a table that does not
    // exist yet, and the failure is confusing rather than obvious.
    const files = ["0010_j.sql", "0002_c.sql", "0000_a.sql"];

    expect(pendingMigrations(files, new Set())).toEqual(["0000_a.sql", "0002_c.sql", "0010_j.sql"]);
  });

  it("never replays an applied migration", () => {
    const files = ["0000_a.sql", "0001_b.sql"];

    expect(pendingMigrations(files, new Set(["0000_a.sql"]))).toEqual(["0001_b.sql"]);
  });

  it("returns nothing when the database is current", () => {
    const files = ["0000_a.sql"];

    expect(pendingMigrations(files, new Set(["0000_a.sql"]))).toEqual([]);
  });

  it("ignores drizzle-kit's meta directory and anything not SQL", () => {
    const files = ["0000_a.sql", "meta", "_journal.json", "README.md"];

    expect(pendingMigrations(files, new Set())).toEqual(["0000_a.sql"]);
  });

  it("applies a migration inserted before an already-applied one", () => {
    // Should not happen with sequential numbering, but if it does, silently
    // skipping it would leave the schema permanently wrong.
    const files = ["0000_a.sql", "0001_b.sql"];

    expect(pendingMigrations(files, new Set(["0001_b.sql"]))).toEqual(["0000_a.sql"]);
  });
});

describe("splitStatements", () => {
  it("splits on drizzle-kit's breakpoint marker", () => {
    const sql = "CREATE TABLE a ();\n--> statement-breakpoint\nCREATE TABLE b ();";

    expect(splitStatements(sql)).toEqual(["CREATE TABLE a ();", "CREATE TABLE b ();"]);
  });

  it("returns a single statement unchanged", () => {
    expect(splitStatements("CREATE TABLE a ();")).toEqual(["CREATE TABLE a ();"]);
  });

  it("drops empty fragments rather than sending blank statements", () => {
    const sql = "CREATE TABLE a ();\n--> statement-breakpoint\n\n--> statement-breakpoint\n  ";

    expect(splitStatements(sql)).toEqual(["CREATE TABLE a ();"]);
  });

  it("handles an empty file", () => {
    expect(splitStatements("")).toEqual([]);
    expect(splitStatements("   \n  ")).toEqual([]);
  });
});
