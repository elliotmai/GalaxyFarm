import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  fixedClock,
  type BaseRecord,
  type FieldChange,
  type OutboxEntry,
  type Patch,
  type Ulid,
} from "@galaxy-farm/core";

import { applyPush } from "../src/sync/push.js";
import { pullSince } from "../src/sync/pull.js";
import { PostgresRepository, type Database } from "../src/repositories/postgres-repository.js";
import { animals, syncAudit, syncFieldMeta } from "../src/schema/index.js";

/**
 * The server side of sync, against a real Postgres.
 *
 * The cases that matter here are the ones that only happen on a bad week: a
 * phone that was in a pocket for three days pushing an edit to a field someone
 * else changed yesterday, two people editing different fields of the same
 * animal, a deletion racing a rename. None of them are reachable by clicking
 * around, and all of them lose data quietly when they go wrong.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER_PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;

const MONDAY = new Date("2026-06-01T08:00:00Z");
const TUESDAY = new Date("2026-06-02T08:00:00Z");
const WEDNESDAY = new Date("2026-06-03T08:00:00Z");

let client: PGlite;
let db: Database;
let nextId = 0;

const ids = { next: () => `01ARZ3NDEKTSV4RRFFQ69G5X${(nextId += 1)}`.slice(0, 26) as Ulid };

function context(now: Date, propertyId: Ulid = PROPERTY) {
  return { propertyId, clock: fixedClock(now), ids };
}

function change(field: string, value: unknown, at: Date, deviceId: string): FieldChange {
  return { field, value, at, deviceId };
}

function entry(id: string, patch: Patch, deviceId = "phone"): OutboxEntry {
  return {
    id: id as Ulid,
    operation: "update",
    patch,
    queuedAt: patch.changes[0]?.at ?? MONDAY,
    deviceId,
    attempts: 0,
  };
}

/** A create patch: every field the record starts with, in one entry. */
function createAnimal(at: Date, deviceId: string, overrides: Record<string, unknown> = {}) {
  const fields: Record<string, unknown> = {
    species: "cattle",
    name: "Andromeda",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "owned",
    safetyLevel: 1,
    ...overrides,
  };
  return {
    entity: "animals",
    recordId: ANIMAL,
    changes: Object.entries(fields).map(([field, value]) => change(field, value, at, deviceId)),
  } satisfies Patch;
}

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
  await client.exec("truncate table animals, sync_field_meta, sync_audit");
});

/** Just enough of the animal shape for these tests to be typed. */
interface AnimalRecord extends BaseRecord {
  readonly species: string;
  readonly name?: string;
  readonly notes?: string;
}

const repository = () => new PostgresRepository<AnimalRecord>(db, animals, ["name"]);

describe("applyPush — creating", () => {
  it("materialises a record from a patch of fields", async () => {
    const result = await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(TUESDAY),
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual(["01ARZ3NDEKTSV4RRFFQ69G5FE1"]);

    const saved = await repository().findById(ANIMAL);
    expect(saved?.name).toBe("Andromeda");
    expect(saved?.propertyId).toBe(PROPERTY);
  });

  it("takes the property from the session, not from the payload", async () => {
    // A device that could name its own propertyId could write into a property
    // it cannot see. `propertyId` is a reserved field for exactly this reason.
    const patch = createAnimal(MONDAY, "phone");
    const forged: Patch = {
      ...patch,
      changes: [...patch.changes, change("propertyId", OTHER_PROPERTY, MONDAY, "phone")],
    };

    await applyPush(db, [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", forged)], context(TUESDAY));

    expect((await repository().findById(ANIMAL))?.propertyId).toBe(PROPERTY);
  });

  it("stamps updatedAt with server arrival time, not the device's clock", async () => {
    // updatedAt is the pull cursor. Stamped with Monday, a record pushed on
    // Wednesday would land behind cursors the other devices already hold, and
    // they would never see it.
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(WEDNESDAY),
    );

    expect((await repository().findById(ANIMAL))?.updatedAt).toEqual(WEDNESDAY);
  });

  it("records who wrote each field and when", async () => {
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(TUESDAY),
    );

    const meta = await db.select().from(syncFieldMeta);
    const name = meta.find((row) => row.field === "name");
    expect(name?.writtenAt).toEqual(MONDAY);
    expect(name?.writtenBy).toBe("phone");
  });
});

describe("applyPush — merging", () => {
  it("keeps both edits when two devices change different fields", async () => {
    // The everyday offline case: someone renames from the house while someone
    // else adds a note in the barn.
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(MONDAY),
    );

    await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE2", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("name", "Andy", TUESDAY, "house")],
        }),
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE3", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("notes", "Off feed this morning", TUESDAY, "kiosk")],
        }),
      ],
      context(WEDNESDAY),
    );

    const saved = await repository().findById(ANIMAL);
    expect(saved?.name).toBe("Andy");
    expect(saved?.notes).toBe("Off feed this morning");
  });

  it("does not let an unrelated newer edit reject an older uncontested one", async () => {
    // The whole reason field-level write times are stored. A phone that edits
    // `notes` on Monday and pushes on Wednesday must keep that edit, even
    // though `name` was changed on Tuesday and the row's updatedAt says so.
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(MONDAY),
    );
    await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE2", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("name", "Andy", TUESDAY, "house")],
        }),
      ],
      context(TUESDAY),
    );

    await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE3", {
          entity: "animals",
          recordId: ANIMAL,
          // Written Monday evening on a phone that had no signal until now.
          changes: [change("notes", "Limping, left hind", MONDAY, "phone")],
        }),
      ],
      context(WEDNESDAY),
    );

    const saved = await repository().findById(ANIMAL);
    expect(saved?.notes).toBe("Limping, left hind");
    expect(saved?.name).toBe("Andy");
  });

  it("gives a contested field to the later write", async () => {
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(MONDAY),
    );

    await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE2", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("name", "Andy", WEDNESDAY, "house")],
        }),
      ],
      context(WEDNESDAY),
    );
    // Arrives after, but was written before — it must lose.
    await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE3", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("name", "Andromeda", TUESDAY, "phone")],
        }),
      ],
      context(WEDNESDAY),
    );

    expect((await repository().findById(ANIMAL))?.name).toBe("Andy");
  });

  it("writes the superseded value down rather than losing it", async () => {
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(MONDAY),
    );
    const result = await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE2", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("name", "Andy", TUESDAY, "house")],
        }),
      ],
      context(TUESDAY),
    );

    expect(result.audit).toHaveLength(1);

    const logged = await db.select().from(syncAudit);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.field).toBe("name");
    expect(logged[0]?.winnerValue).toBe("Andy");
    expect(logged[0]?.loserValue).toBe("Andromeda");
  });

  it("logs nothing when two devices write the same value", async () => {
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(MONDAY),
    );
    await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE2", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("name", "Andromeda", TUESDAY, "house")],
        }),
      ],
      context(TUESDAY),
    );

    // Agreement is not a conflict, and logging it would bury the real ones.
    expect(await db.select().from(syncAudit)).toHaveLength(0);
  });
});

describe("applyPush — deleting", () => {
  it("carries a tombstone through as an ordinary field write", async () => {
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(MONDAY),
    );

    await applyPush(
      db,
      [
        {
          ...entry("01ARZ3NDEKTSV4RRFFQ69G5FE2", {
            entity: "animals",
            recordId: ANIMAL,
            changes: [
              change("deletedAt", TUESDAY, TUESDAY, "house"),
              change("deletedBy", PROPERTY, TUESDAY, "house"),
              change("deletedReason", "Sold", TUESDAY, "house"),
            ],
          }),
          operation: "delete",
        },
      ],
      context(TUESDAY),
    );

    expect(await repository().count({ propertyId: PROPERTY })).toBe(0);
    expect(await repository().count({ propertyId: PROPERTY, includeDeleted: true })).toBe(1);
    // Still pullable, so a device that missed the deletion learns about it.
    const pages = await pullSince(db, {
      propertyId: PROPERTY,
      cursors: {},
      entities: ["animals"],
    });
    expect(pages[0]?.records).toHaveLength(1);
  });

  it("restores a record when the tombstone fields are cleared", async () => {
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(MONDAY),
    );
    await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE2", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("deletedAt", TUESDAY, TUESDAY, "house")],
        }),
      ],
      context(TUESDAY),
    );

    await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE3", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("deletedAt", undefined, WEDNESDAY, "house")],
        }),
      ],
      context(WEDNESDAY),
    );

    expect(await repository().count({ propertyId: PROPERTY })).toBe(1);
  });
});

describe("applyPush — refusing", () => {
  it("rejects one bad entry without dropping the good ones behind it", async () => {
    // A week's worth of queued work must not be held hostage by one patch.
    const result = await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", {
          entity: "dragons",
          recordId: ANIMAL,
          changes: [change("name", "Smaug", MONDAY, "phone")],
        }),
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE2", createAnimal(MONDAY, "phone")),
      ],
      context(TUESDAY),
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain("dragons");
    expect(result.accepted).toEqual(["01ARZ3NDEKTSV4RRFFQ69G5FE2"]);
    expect(await repository().count({ propertyId: PROPERTY })).toBe(1);
  });

  it("refuses to touch a record belonging to another property", async () => {
    await applyPush(
      db,
      [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))],
      context(MONDAY, OTHER_PROPERTY),
    );

    const result = await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE2", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("name", "Taken", TUESDAY, "phone")],
        }),
      ],
      context(TUESDAY, PROPERTY),
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toContain("another property");
  });

  it("drops a field this deploy no longer has rather than failing the entry", async () => {
    // An older device still sending a removed field should keep syncing
    // everything else it has queued.
    const patch = createAnimal(MONDAY, "phone");
    const result = await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", {
          ...patch,
          changes: [...patch.changes, change("favouriteColour", "blue", MONDAY, "phone")],
        }),
      ],
      context(TUESDAY),
    );

    expect(result.rejected).toEqual([]);
    expect((await repository().findById(ANIMAL))?.name).toBe("Andromeda");
  });

  it("accepts a patch with nothing left to apply as a no-op", async () => {
    const result = await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", {
          entity: "animals",
          recordId: ANIMAL,
          changes: [change("id", "something-else", MONDAY, "phone")],
        }),
      ],
      context(TUESDAY),
    );

    // Rejecting would make the outbox retry it forever.
    expect(result.accepted).toHaveLength(1);
    expect(await repository().count({ propertyId: PROPERTY, includeDeleted: true })).toBe(0);
  });

  it("rejects an entry whose record would violate the schema", async () => {
    const result = await applyPush(
      db,
      [
        entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", {
          entity: "animals",
          recordId: ANIMAL,
          // No species, and the column is NOT NULL.
          changes: [change("name", "Nameless", MONDAY, "phone")],
        }),
      ],
      context(TUESDAY),
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("is idempotent when a dropped connection makes a device push twice", async () => {
    const batch = [entry("01ARZ3NDEKTSV4RRFFQ69G5FE1", createAnimal(MONDAY, "phone"))];

    await applyPush(db, batch, context(TUESDAY));
    const second = await applyPush(db, batch, context(WEDNESDAY));

    expect(second.rejected).toEqual([]);
    expect(await repository().count({ propertyId: PROPERTY })).toBe(1);
    // Replaying an identical patch is not a conflict with itself.
    expect(await db.select().from(syncAudit)).toHaveLength(0);
  });
});
