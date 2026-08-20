import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Migration 0031, against the rows the breeding screen actually wrote.
 *
 * Reported from the farm: breeding dates were a day early. The field hands
 * over `2026-02-14` and `new Date` of a bare date string is midnight UTC,
 * which `toLocaleDateString` renders as the 13th anywhere west of Greenwich.
 *
 * A data migration is worth testing more than a schema one, not less: a wrong
 * `ADD COLUMN` fails loudly, and a wrong `UPDATE` succeeds quietly and takes
 * real records with it. This one moves the date a cow's whole pregnancy is
 * projected from, so what it must not do matters as much as what it does.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01KDVDNA00K7VF2PAYH5SD1M8W";
const COW = "01KDVDNA00WG3QBZK6TE2N9XH5";

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

/** Everything before the repair, so the bad rows can be put in first. */
const BEFORE_REPAIR = "0030_zzzz.sql";
const REPAIR = readFileSync(join(MIGRATIONS_DIR, "0031_repair_breeding_dates.sql"), "utf8");

interface Row {
  readonly id: string;
  readonly date: Date;
  readonly updated_at: Date;
}

async function breedings(): Promise<Row[]> {
  const result = await client.query<Row>(`select id, date, updated_at from breeding_records
     where deleted_at is null order by id`);
  return result.rows;
}

async function insert(id: string, date: string, updatedAt = "2026-02-14T18:00:00Z") {
  await client.query(
    `insert into breeding_records (id, property_id, created_at, updated_at, dam_id, method, date)
     values ($1, $2, $3, $4, $5, 'AI', $6)`,
    [id, PROPERTY, updatedAt, updatedAt, COW, date],
  );
}

describe("migration 0031", () => {
  beforeAll(async () => {
    client = new PGlite();
    await runMigrations(BEFORE_REPAIR);
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.exec("delete from breeding_records");
  });

  it("moves a midnight-UTC breeding to midday, keeping the day it meant", async () => {
    // What the screen wrote for a cow bred on 14 February.
    await insert("01KDVDNA0000000000000000A1", "2026-02-14T00:00:00Z");
    await client.exec(REPAIR);

    const [row] = await breedings();
    expect(row?.date.toISOString()).toBe("2026-02-14T12:00:00.000Z");
  });

  it("puts the day right in the timezone the farm is actually in", async () => {
    // The symptom, in the terms it was reported: rendered locally, it said the
    // 13th. Midday UTC says the 14th here and everywhere from UTC-11 to UTC+11.
    await insert("01KDVDNA0000000000000000A2", "2026-02-14T00:00:00Z");

    const before = (await breedings())[0]?.date as Date;
    expect(before.toLocaleDateString("en-US", { timeZone: "America/Chicago" })).toBe("2/13/2026");

    await client.exec(REPAIR);

    const after = (await breedings())[0]?.date as Date;
    expect(after.toLocaleDateString("en-US", { timeZone: "America/Chicago" })).toBe("2/14/2026");
    expect(after.toLocaleDateString("en-US", { timeZone: "Pacific/Honolulu" })).toBe("2/14/2026");
    expect(after.toLocaleDateString("en-US", { timeZone: "Asia/Tokyo" })).toBe("2/14/2026");
  });

  it("leaves a correctly stored breeding alone", async () => {
    // Midday local in Iowa is 18:00 UTC — not midnight anywhere, which is the
    // whole reason the repair can tell the two apart.
    await insert("01KDVDNA0000000000000000A3", "2026-02-14T18:00:00Z");
    await client.exec(REPAIR);

    const [row] = await breedings();
    expect(row?.date.toISOString()).toBe("2026-02-14T18:00:00.000Z");
    // And its cursor does not move, so no device re-pulls a row that is fine.
    expect(row?.updated_at.toISOString()).toBe("2026-02-14T18:00:00.000Z");
  });

  it("moves the cursor on the rows it repairs, so devices pull them", async () => {
    // §4.2: a device pulls what changed since its cursor. A repair that left
    // `updated_at` alone would fix the server and leave every phone showing
    // the old day.
    await insert("01KDVDNA0000000000000000A4", "2026-02-14T00:00:00Z");
    await client.exec(REPAIR);

    const [row] = await breedings();
    expect(row?.updated_at.getTime()).toBeGreaterThan(new Date("2026-02-14T18:00:00Z").getTime());
  });

  it("does not raise the dead", async () => {
    await insert("01KDVDNA0000000000000000A5", "2026-02-14T00:00:00Z");
    await client.exec(`update breeding_records set deleted_at = now()`);
    await client.exec(REPAIR);

    const result = await client.query<{ date: Date }>(
      `select date from breeding_records where deleted_at is not null`,
    );
    expect(result.rows[0]?.date.toISOString()).toBe("2026-02-14T00:00:00.000Z");
  });
});
