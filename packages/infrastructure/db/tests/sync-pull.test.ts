import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { advance, type BaseRecord, type CursorSet, type Ulid } from "@galaxy-farm/core";

import { PostgresRepository, type Database } from "../src/repositories/postgres-repository.js";
import { animals } from "../src/schema/index.js";
import { pullSince, syncedEntities } from "../src/sync/pull.js";

/**
 * Serving a pull, against a real Postgres.
 *
 * The failure this guards against is a record that is never returned to a
 * device again — skipped at a page boundary, or filtered out by a cursor that
 * moved one millisecond too far. Nothing surfaces it: the record is simply
 * absent on one phone, and everyone assumes it was never entered.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER_PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const AT = new Date("2026-06-01T08:00:00Z");

let client: PGlite;
let db: Database;

function animal(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: id as Ulid,
    propertyId: PROPERTY,
    createdAt: AT,
    updatedAt: AT,
    species: "cattle",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "owned",
    safetyLevel: 1,
    ...overrides,
  } as never;
}

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}`;

beforeAll(async () => {
  client = new PGlite();
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await client.exec(statement);
    }
  }
  db = drizzle(client) as unknown as Database;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec("truncate table animals");
});

/** Just enough of the animal shape for these tests to be typed. */
interface AnimalRecord extends BaseRecord {
  readonly species: string;
  readonly name?: string;
  readonly notes?: string;
}

const repository = () => new PostgresRepository<AnimalRecord>(db, animals, ["name"]);
const pull = (cursors: CursorSet = {}, limit?: number) =>
  pullSince<AnimalRecord>(db, {
    propertyId: PROPERTY,
    cursors,
    entities: ["animals"],
    ...(limit ? { limit } : {}),
  });

describe("pullSince", () => {
  it("returns everything when a device has no cursor yet", async () => {
    await repository().saveMany([animal(id(1)), animal(id(2))]);

    const pages = await pull();

    expect(pages).toHaveLength(1);
    expect(pages[0]?.records).toHaveLength(2);
    expect(pages[0]?.hasMore).toBe(false);
  });

  it("never leaks another property's records", async () => {
    await repository().saveMany([animal(id(1)), animal(id(2), { propertyId: OTHER_PROPERTY })]);

    expect((await pull())[0]?.records).toHaveLength(1);
  });

  it("returns tombstones, because a deletion travels as a record", async () => {
    await repository().save(animal(id(1), { deletedAt: AT, deletedBy: PROPERTY }));

    expect((await pull())[0]?.records).toHaveLength(1);
  });

  it("returns only what changed after the cursor", async () => {
    await repository().saveMany([
      animal(id(1), { updatedAt: new Date("2026-06-01T08:00:00Z") }),
      animal(id(2), { updatedAt: new Date("2026-06-02T08:00:00Z") }),
    ]);

    const pages = await pull({
      animals: { entity: "animals", updatedAt: new Date("2026-06-01T08:00:00Z"), lastId: id(1) },
    });

    expect(pages[0]?.records.map((r) => r.id)).toEqual([id(2)]);
  });

  it("does not skip a record sharing the cursor's millisecond", async () => {
    // Two records written in the same millisecond, split across a page
    // boundary. Without the id tie-break the second is gone for good.
    await repository().saveMany([animal(id(1)), animal(id(2)), animal(id(3))]);

    const first = await pull({}, 1);
    const second = await pull(advance({}, "animals", first[0]?.records ?? []), 1);

    expect(first[0]?.records.map((r) => r.id)).toEqual([id(1)]);
    expect(second[0]?.records.map((r) => r.id)).toEqual([id(2)]);
  });

  it("says when there is more, without counting the table", async () => {
    await repository().saveMany([animal(id(1)), animal(id(2)), animal(id(3))]);

    const page = await pull({}, 2);

    expect(page[0]?.records).toHaveLength(2);
    expect(page[0]?.hasMore).toBe(true);
  });

  it("does not claim more on an exactly-full page that empties the table", async () => {
    await repository().saveMany([animal(id(1)), animal(id(2))]);

    expect((await pull({}, 2))[0]?.hasMore).toBe(false);
  });

  it("drains completely when a device walks the pages", async () => {
    // The catch-up loop the engine runs, end to end.
    await repository().saveMany([1, 2, 3, 4, 5].map((n) => animal(id(n))));

    const seen: string[] = [];
    let cursors: CursorSet = {};
    for (let round = 0; round < 10; round += 1) {
      const pages = await pull(cursors, 2);
      const records = pages[0]?.records ?? [];
      seen.push(...records.map((r) => r.id));
      cursors = advance(cursors, "animals", records);
      if (!pages[0]?.hasMore) break;
    }

    expect(seen).toEqual([id(1), id(2), id(3), id(4), id(5)]);
  });

  it("omits an entity with nothing new rather than sending an empty page", async () => {
    expect(await pull()).toEqual([]);
  });

  it("skips an entity it does not recognise instead of failing the pull", async () => {
    // An older device asking for something this deploy renamed should still
    // sync everything else it knows about.
    await repository().save(animal(id(1)));

    const pages = await pullSince<AnimalRecord>(db, {
      propertyId: PROPERTY,
      cursors: {},
      entities: ["dragons", "animals"],
    });

    expect(pages.map((page) => page.entity)).toEqual(["animals"]);
  });

  it("hands back Dates, not strings", async () => {
    await repository().save(animal(id(1)));

    expect((await pull())[0]?.records[0]?.updatedAt).toBeInstanceOf(Date);
  });
});

describe("syncedEntities", () => {
  it("offers every entity a device holds, and neither bookkeeping table", () => {
    // A patch naming sync_audit would be a device writing its own change log.
    expect(syncedEntities()).toContain("animals");
    expect(syncedEntities()).not.toContain("syncAudit");
    expect(syncedEntities()).not.toContain("syncFieldMeta");
  });
});
