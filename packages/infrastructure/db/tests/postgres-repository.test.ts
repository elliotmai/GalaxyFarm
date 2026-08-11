import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  repositoryConformanceCases,
  unsearchableRepositoryCases,
  type ConformanceRecord,
} from "@galaxy-farm/core/testing";

import { baseColumns } from "../src/schema/columns.js";
import {
  PostgresRepository,
  escapeLikePattern,
  type Database,
  type RecordTable,
} from "../src/repositories/postgres-repository.js";

/**
 * The Postgres store runs the same contract as the in-memory and IndexedDB
 * implementations.
 *
 * Against PGlite — PostgreSQL 18 in WASM, the same engine, not a mock. A store
 * whose `list` disagrees with the local store's produces data that appears on
 * one device and not another, and there is no test on either side alone that
 * would catch it.
 */

// Test-only table, built from the same `baseColumns` every real table uses, so
// the contract runs against the shape the schema actually produces.
const conformanceRecords = pgTable("conformance_records", {
  ...baseColumns,
  name: text("name").notNull(),
  tally: integer("tally").notNull(),
});

const CREATE_TABLE = `
  create table conformance_records (
    id text primary key,
    property_id text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    deleted_by text,
    deleted_reason text,
    name text not null,
    tally integer not null
  )
`;

let client: PGlite;
let db: Database;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(CREATE_TABLE);
  db = drizzle(client) as unknown as Database;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec("truncate table conformance_records");
});

function repository(searchable: readonly (keyof ConformanceRecord & string)[] = ["name"]) {
  return new PostgresRepository<ConformanceRecord>(
    db,
    conformanceRecords as unknown as RecordTable,
    searchable,
  );
}

describe("PostgresRepository — repository contract", () => {
  for (const testCase of repositoryConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run(repository());
    });
  }

  for (const testCase of unsearchableRepositoryCases) {
    it(testCase.name, async () => {
      await testCase.run(repository([]));
    });
  }
});

describe("PostgresRepository — Postgres specifics", () => {
  const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1";
  const AT = new Date("2026-06-01T00:00:00Z");

  function record(id: string, overrides: Partial<ConformanceRecord> = {}): ConformanceRecord {
    return {
      id,
      propertyId: PROPERTY,
      createdAt: AT,
      updatedAt: AT,
      name: "Bale spear",
      tally: 1,
      ...overrides,
    } as ConformanceRecord;
  }

  it("upserts rather than failing when a sync push replays a record", async () => {
    // A push retried after a dropped connection sends rows the server already
    // has. If that is a primary key violation, the retry can never succeed.
    const repo = repository();
    const rows = [record("01ARZ3NDEKTSV4RRFFQ69G5FR1"), record("01ARZ3NDEKTSV4RRFFQ69G5FR2")];

    await repo.saveMany(rows);
    await repo.saveMany(rows.map((row) => ({ ...row, tally: 7 })));

    expect(await repo.count({ propertyId: PROPERTY } as never)).toBe(2);
    expect((await repo.findById("01ARZ3NDEKTSV4RRFFQ69G5FR1" as never))?.tally).toBe(7);
  });

  it("clears a column when a field goes from set to absent", async () => {
    // Restoring from Trash deletes the tombstone keys outright. An upsert that
    // only wrote present fields would leave deleted_at behind, and the record
    // would come back still deleted.
    const repo = repository();
    const id = "01ARZ3NDEKTSV4RRFFQ69G5FR1";

    await repo.save(record(id, { deletedAt: AT, deletedBy: PROPERTY as never }));
    await repo.save(record(id));

    const found = await repo.findById(id as never);
    expect(found?.deletedAt).toBeUndefined();
    expect("deletedAt" in (found ?? {})).toBe(false);
  });

  it("reads timestamps back as Dates in UTC", async () => {
    const repo = repository();
    const id = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
    await repo.save(record(id));

    const found = await repo.findById(id as never);
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.createdAt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  describe("escapeLikePattern", () => {
    it("escapes the three characters ilike would otherwise read as syntax", () => {
      expect(escapeLikePattern("50%")).toBe("50\\%");
      expect(escapeLikePattern("a_b")).toBe("a\\_b");
      expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    });

    it("leaves ordinary text alone", () => {
      expect(escapeLikePattern("Hay ring")).toBe("Hay ring");
    });
  });
});
