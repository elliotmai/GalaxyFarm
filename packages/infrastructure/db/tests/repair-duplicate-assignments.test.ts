import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Migration 0024, against the rows that were actually reported.
 *
 * A cow set to the zone she was already in ended up assigned to it twice: two
 * rows, same animal, same zone, both open. `moveToZone` is fixed, but the rows
 * it already wrote are on a real server and no screen can render them
 * honestly.
 *
 * Data migrations are worth testing more than schema ones, not less. A wrong
 * `ADD COLUMN` fails loudly; a wrong `UPDATE` succeeds and quietly takes real
 * records with it, and this one is aimed at a table holding where every animal
 * on the place has ever stood.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

/** The real ids from the report, so the fixture is the case, not a sketch. */
const PROPERTY = "01KDVDNA00K7VF2PAYH5SD1M8W";
const COW = "01KDVDNA00WG3QBZK6TE2N9XH5";
const FIRST_ZONE = "01KDVDNA000M8VF3QBYJ6TD1N9";
const TRAP = "01KDVDNA002PAYH5SD1M8WG3QB";

let client: PGlite;

const runMigrations = async (upTo?: string) => {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (upTo !== undefined && file > upTo) continue;
    for (const statement of readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await client.exec(statement);
    }
  }
};

/** Everything except 0024, so the broken rows can be put in first. */
const BEFORE_REPAIR = "0023_zzzz.sql";
const REPAIR = readFileSync(join(MIGRATIONS_DIR, "0024_repair_duplicate_assignments.sql"), "utf8");

interface Row {
  readonly id: string;
  readonly period_to: string | null;
  readonly deleted_at: string | null;
  readonly deleted_reason: string | null;
  readonly period_from: Date | string;
}

const openRows = async (): Promise<Row[]> =>
  (
    await client.query<Row>(
      `SELECT id, period_to, deleted_at, deleted_reason, period_from
         FROM zone_assignments
        WHERE deleted_at IS NULL AND period_to IS NULL
        ORDER BY period_from`,
    )
  ).rows;

const insert = async (
  id: string,
  zoneId: string,
  from: string,
  to: string | null,
  slot: string,
) => {
  await client.query(
    `INSERT INTO zone_assignments
       (id, property_id, created_at, updated_at, animal_id, zone_id, period_from, period_to, slot)
     VALUES ($1, $2, $3, $3, $4, $5, $3, $6, $7)`,
    [id, PROPERTY, from, COW, zoneId, to, slot],
  );
};

beforeAll(async () => {
  client = new PGlite();
  await runMigrations(BEFORE_REPAIR);
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec("truncate table zone_assignments");
});

describe("repairing a cow assigned to one zone twice", () => {
  /** Exactly the three rows from the report. */
  const reported = async () => {
    await insert(
      "01KDVDNA00BZK7VE2PAXH5SC0M",
      FIRST_ZONE,
      "2026-08-12 00:04:32.669+00",
      "2026-08-12 00:10:01.146+00",
      "primary",
    );
    await insert("01KZSMVY1T6B9NPN3W71730JXE", TRAP, "2026-08-12 00:10:01.146+00", null, "outside");
    await insert("01M00GNS9VHSWJ4SG387QW4G8R", TRAP, "2026-08-14 16:11:26.395+00", null, "outside");
  };

  it("leaves her standing in one place, once", async () => {
    await reported();
    await client.exec(REPAIR);

    const open = await openRows();
    expect(open).toHaveLength(1);
  });

  it("keeps the older row, because it holds the date she actually arrived", async () => {
    // Keeping the newer one would silently reset her arrival to the day the
    // duplicate was written, which is a fact nobody would ever notice was gone.
    await reported();
    await client.exec(REPAIR);

    const open = await openRows();
    expect(open[0]?.id).toBe("01KZSMVY1T6B9NPN3W71730JXE");
    expect(String(open[0]?.period_from)).toContain("Aug 12 2026");
  });

  it("tombstones the duplicate with a reason rather than deleting it", async () => {
    // §4.5: nothing is destroyed. The row goes to Trash saying why, which is
    // also the only way somebody could tell this migration from data loss.
    await reported();
    await client.exec(REPAIR);

    const { rows } = await client.query<{ deleted_reason: string | null }>(
      `SELECT deleted_reason FROM zone_assignments WHERE id = '01M00GNS9VHSWJ4SG387QW4G8R'`,
    );
    expect(rows[0]?.deleted_reason).toContain("Duplicate open assignment");
  });

  it("moves updated_at, so the repair reaches the phones", async () => {
    // Without this the duplicate stays in a device's local store forever and
    // the screen keeps showing it, whatever the server says.
    await reported();
    const before = await client.query<{ updated_at: string }>(
      `SELECT updated_at FROM zone_assignments WHERE id = '01M00GNS9VHSWJ4SG387QW4G8R'`,
    );
    await client.exec(REPAIR);
    const after = await client.query<{ updated_at: string }>(
      `SELECT updated_at FROM zone_assignments WHERE id = '01M00GNS9VHSWJ4SG387QW4G8R'`,
    );

    expect(after.rows[0]?.updated_at).not.toBe(before.rows[0]?.updated_at);
  });

  it("does not touch the assignment she had already left", async () => {
    // A closed row is history and history is the thing this app refuses to
    // overwrite. It is not open, so it is not a duplicate of anything.
    await reported();
    await client.exec(REPAIR);

    const { rows } = await client.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM zone_assignments WHERE id = '01KDVDNA00BZK7VE2PAXH5SC0M'`,
    );
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("leaves two open rows in different zones for a person to settle", async () => {
    // A genuine conflict about where an animal is. Only somebody who was there
    // knows which is right, and quietly picking one would destroy the evidence
    // that there was ever a question.
    await insert("01AAA0000000000000000000A1", TRAP, "2026-08-12 00:00:00+00", null, "outside");
    await insert(
      "01AAA0000000000000000000A2",
      FIRST_ZONE,
      "2026-08-14 00:00:00+00",
      null,
      "outside",
    );

    await client.exec(REPAIR);

    expect(await openRows()).toHaveLength(2);
  });

  it("is safe to run twice", async () => {
    // Migrations get re-run — a restored backup, a re-pointed environment, a
    // baseline that adopted the wrong mark. A repair that eats another row on
    // its second pass is worse than the fault it fixes.
    await reported();
    await client.exec(REPAIR);
    await client.exec(REPAIR);

    expect(await openRows()).toHaveLength(1);
  });

  it("does nothing at all to a farm that never hit the bug", async () => {
    await insert("01BBB0000000000000000000B1", TRAP, "2026-08-12 00:00:00+00", null, "outside");

    await client.exec(REPAIR);

    expect(await openRows()).toHaveLength(1);
  });
});
