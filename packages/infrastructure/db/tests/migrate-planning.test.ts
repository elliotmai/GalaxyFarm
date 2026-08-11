import { readdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MIGRATIONS_DIR,
  isEntryPoint,
  pendingMigrations,
  splitStatements,
} from "../src/migrate.js";

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

describe("isEntryPoint", () => {
  it("recognises the module it was asked to run", () => {
    expect(isEntryPoint(pathToFileURL("/repo/src/migrate.ts").href, "/repo/src/migrate.ts")).toBe(
      true,
    );
  });

  it("recognises a Windows path, which a hand-built file:// URL does not", () => {
    // The bug this exists for: `file://${argv[1]}` gives `file://C:\repo\...`,
    // `import.meta.url` gives `file:///C:/repo/...`, they never match, and
    // `pnpm db:migrate` exits 0 having applied nothing. A migration runner
    // that silently does nothing is worse than one that crashes.
    const windowsPath = "C:\\GalaxyFarm\\packages\\infrastructure\\db\\src\\migrate.ts";
    const href = pathToFileURL(windowsPath).href;

    expect(isEntryPoint(href, windowsPath)).toBe(true);
    expect(href === `file://${windowsPath}`).toBe(false);
  });

  it("says no when the module was imported rather than run", () => {
    expect(isEntryPoint(pathToFileURL("/repo/src/migrate.ts").href, "/repo/src/other.ts")).toBe(
      false,
    );
  });

  it("says no when there is no argv at all", () => {
    expect(isEntryPoint("file:///repo/src/migrate.ts", undefined)).toBe(false);
    expect(isEntryPoint("file:///repo/src/migrate.ts", "")).toBe(false);
  });
});

describe("finding the migrations", () => {
  it("resolves a directory that actually holds them", () => {
    // The bug: `new URL(...).pathname` gives `/C:/GalaxyFarm/...` on Windows,
    // and `readdirSync` turns that into `C:\C:\GalaxyFarm\...`. Resolving from
    // the module's own URL is the only way to find them regardless of where
    // the command was run from, so it has to be done correctly.
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("0000_initial_schema.sql");
  });

  it("is an absolute path a filesystem call will accept", () => {
    expect(isAbsolute(MIGRATIONS_DIR)).toBe(true);
    // The failure signature: a drive letter with a slash in front of it.
    expect(MIGRATIONS_DIR).not.toMatch(/^\/[A-Za-z]:/);
  });

  it("shows why pathname cannot be used for this", () => {
    // Documenting the trap rather than just avoiding it — the two agree on
    // POSIX, which is why this survived review and CI both.
    const windowsModule = "file:///C:/GalaxyFarm/packages/infrastructure/db/src/migrate.ts";
    const viaPathname = new URL("../migrations", windowsModule).pathname;

    expect(viaPathname).toBe("/C:/GalaxyFarm/packages/infrastructure/db/migrations");
    expect(isAbsolute(viaPathname)).toBe(process.platform !== "win32");
  });
});
