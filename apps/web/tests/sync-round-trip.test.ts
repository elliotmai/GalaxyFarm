import { PGlite } from "@electric-sql/pglite";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  encodeUlid,
  systemClock,
  type BaseRecord,
  type Repository,
  type Ulid,
} from "@galaxy-farm/core";
import { applyPush, pullSince, type Database } from "@galaxy-farm/infra-db";
import { DexieOutbox, FarmDatabase, type StoredRecord } from "@galaxy-farm/infra-local";
import { SyncEngine } from "@galaxy-farm/infra-sync";
import { DexieRepository } from "@galaxy-farm/infra-local";

import { LOCAL_SCHEMA_VERSION, LOCAL_STORES } from "../lib/local/store.js";
import { reviveCursors, reviveOutboxEntries } from "../lib/sync-payload.js";
import { httpTransport } from "../lib/local/transport.js";

/**
 * One edit, from a field on a phone to a row in Postgres and back (spec §4.2).
 *
 * **Why this exists.** Every piece of the sync path was tested against a fake
 * of the piece next to it: the engine against a fake transport, the transport
 * against a fake fetch, the push handler against hand-built entries. Each of
 * those suites passed while the thing they add up to did not work, because no
 * test ever ran the real outbox through the real engine through the real
 * transport into the real handler. A seam is exactly where a wiring bug lives,
 * and a suite of unit tests either side of a seam cannot see one.
 *
 * So this wires the actual objects together and puts a real Postgres (PGlite,
 * in process) at the end. The only thing faked is `fetch`, and it is faked by
 * calling the same two functions the route handlers call — so the JSON that
 * crosses the boundary is the JSON that crosses it in production, including
 * the date-to-string round trip that neither end trusts the other to do.
 */

const MIGRATIONS = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = encodeUlid(1) as Ulid;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function freshServer(upTo?: number): Promise<Database> {
  const pg = new PGlite();
  for (const file of migrationFiles().slice(0, upTo)) {
    for (const statement of readFileSync(join(MIGRATIONS, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await pg.exec(statement);
    }
  }
  return drizzle(pg) as unknown as Database;
}

/**
 * `fetch`, answered by the same code the route handlers run.
 *
 * Deliberately not importing the route handlers themselves — those pull in
 * Auth.js and a Next request object. What matters here is the payload contract
 * between `transport.ts` and `sync-payload.ts`, which is where a mismatch
 * would be silent: a push whose entries the server cannot see returns 200 with
 * nothing accepted, so the queue grows and no error is ever shown.
 */
function serverFetch(db: Database): typeof globalThis.fetch {
  return (async (url: string, init: RequestInit) => {
    const body: unknown = JSON.parse(String(init.body));

    if (url.endsWith("/push")) {
      const entries = reviveOutboxEntries(body);
      const result = await applyPush(db, entries, {
        propertyId: PROPERTY,
        clock: systemClock(),
        ids: { next: () => encodeUlid(Date.now()) },
      });
      return new Response(JSON.stringify(result), { status: 200 });
    }

    const raw = body as Record<string, unknown>;
    const pages = await pullSince(db, {
      propertyId: PROPERTY,
      cursors: reviveCursors(raw["cursors"]),
      entities: Array.isArray(raw["entities"]) ? (raw["entities"] as string[]) : [...LOCAL_STORES],
    });
    return new Response(JSON.stringify({ pages }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
}

let opened = 0;

/** Its own isolated IndexedDB per stack, so cases cannot see each other. */
function freshLocal(): FarmDatabase {
  opened += 1;
  return new FarmDatabase({
    name: `round-trip-${opened}`,
    stores: [...LOCAL_STORES],
    schemaVersion: LOCAL_SCHEMA_VERSION,
    indexedDB: new IDBFactory(),
    iDBKeyRange: FakeIDBKeyRange as unknown as typeof IDBKeyRange,
  });
}

function localStack(db: Database) {
  const local = freshLocal();
  const outbox = new DexieOutbox(local);

  const repositories = new Map<string, Repository<StoredRecord>>(
    LOCAL_STORES.map((name) => [name, new DexieRepository<StoredRecord>(local, name, [])]),
  );

  const engine = new SyncEngine<StoredRecord>({
    outbox,
    transport: httpTransport<StoredRecord>({ fetch: serverFetch(db) }),
    repositories,
    clock: systemClock(),
    ids: { next: () => encodeUlid(Date.now()) },
    deviceId: "test-device",
  });

  return { local, outbox, engine, repositories };
}

/** What a screen does: write locally, then queue the diff. */
async function edit(
  stack: ReturnType<typeof localStack>,
  entity: (typeof LOCAL_STORES)[number],
  record: BaseRecord & Record<string, unknown>,
  fields: readonly string[],
) {
  await (stack.repositories.get(entity) as Repository<StoredRecord>).save(
    record as unknown as StoredRecord,
  );
  await stack.engine.enqueue("create", {
    entity,
    recordId: record.id,
    changes: fields.map((field) => ({
      field,
      value: record[field] as never,
      at: record.updatedAt,
      deviceId: "test-device",
    })),
  });
}

const now = new Date("2026-08-11T12:00:00Z");

function animal(id: Ulid, name: string) {
  return {
    id,
    propertyId: PROPERTY,
    createdAt: now,
    updatedAt: now,
    species: "cattle",
    name,
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
  } as unknown as BaseRecord & Record<string, unknown>;
}

describe("one edit, all the way to Postgres and back", () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshServer();
  });

  it("empties the outbox and lands the row on the server", async () => {
    const stack = localStack(db);
    await edit(stack, "animals", animal(encodeUlid(10) as Ulid, "Andromeda"), [
      "propertyId",
      "createdAt",
      "updatedAt",
      "species",
      "name",
      "sex",
      "dobIsEstimate",
      "status",
      "ownership",
      "safetyLevel",
      "photoKeys",
    ]);

    expect(await stack.outbox.pending()).toHaveLength(1);

    const outcome = await stack.engine.sync();

    // The three assertions that matter, and the one that was missing: the
    // queue is *empty afterwards*. A push that returns 200 having quietly
    // accepted nothing leaves the count climbing with no error anywhere.
    expect(outcome.rejected, `rejected: ${JSON.stringify(outcome)}`).toBe(0);
    expect(outcome.pushed).toBe(1);
    expect(await stack.outbox.pending()).toHaveLength(0);

    const rows = await pullSince(db, {
      propertyId: PROPERTY,
      cursors: {},
      entities: ["animals"],
    });
    const animals = rows.find((page) => page.entity === "animals");
    expect(animals?.records).toHaveLength(1);
    expect((animals?.records[0] as unknown as { name: string }).name).toBe("Andromeda");
  }, 60_000);

  it("drains every entity the device can hold, not just the ones with screens", async () => {
    // The failure this catches: an entity in `LOCAL_STORES` that the server
    // does not accept is a queue that never empties, and the only symptom is a
    // number going up. Rather than listing entities here — a list that would
    // go stale — it walks the device's own store list.
    const stack = localStack(db);

    for (const [index, entity] of LOCAL_STORES.entries()) {
      await stack.engine.enqueue("create", {
        entity,
        recordId: encodeUlid(100 + index) as Ulid,
        changes: [{ field: "createdAt", value: now as never, at: now, deviceId: "test-device" }],
      });
    }

    /*
     * Synced in a loop rather than once, because the engine pushes 50 entries
     * per call and the store list is longer than that. One `sync()` used to be
     * enough and quietly stopped being so the moment the garden's ten entities
     * landed — leaving nine in the queue with nothing rejected, which reads
     * exactly like the bug this test is for. Draining to empty asks the
     * question the test means to ask: is any entity *refused*, whatever the
     * batch size happens to be.
     */
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const outcome = await stack.engine.sync();

      expect(
        outcome.rejected,
        `some entities were refused by the server: ${JSON.stringify(outcome)}`,
      ).toBe(0);

      if ((await stack.outbox.pending()).length === 0) break;
    }

    expect(await stack.outbox.pending()).toHaveLength(0);
  }, 60_000);

  it("keeps the work when the server is unreachable, and sends it when it comes back", async () => {
    // Nothing is lost, which is the entire point of the outbox — and the queue
    // has to actually drain once the server answers again rather than staying
    // wedged behind the failed attempt.
    const local = freshLocal();
    const outbox = new DexieOutbox(local);
    const repositories = new Map<string, Repository<StoredRecord>>(
      LOCAL_STORES.map((name) => [name, new DexieRepository<StoredRecord>(local, name, [])]),
    );

    let online = false;
    const flaky = (async (url: string, init: RequestInit) => {
      if (!online) throw new TypeError("Failed to fetch");
      return serverFetch(db)(url as never, init as never);
    }) as unknown as typeof globalThis.fetch;

    const engine = new SyncEngine<StoredRecord>({
      outbox,
      transport: httpTransport<StoredRecord>({ fetch: flaky }),
      repositories,
      clock: systemClock(),
      ids: { next: () => encodeUlid(Date.now()) },
      deviceId: "test-device",
    });

    // A complete record, not a lone field: the server builds the row from the
    // patch, and a partial one fails its NOT NULL columns — which is a
    // rejection rather than a transport failure, and not what this is testing.
    const dolly = animal(encodeUlid(20) as Ulid, "Dolly");
    await engine.enqueue("create", {
      entity: "animals",
      recordId: dolly["id"] as Ulid,
      changes: Object.keys(dolly).map((field) => ({
        field,
        value: dolly[field] as never,
        at: now,
        deviceId: "test-device",
      })),
    });

    const offline = await engine.push();
    expect(offline.offline).toBe(true);
    expect(await outbox.pending()).toHaveLength(1);

    online = true;
    // A fresh engine rather than waiting out the backoff: the assertion is
    // that the entry survived and is still sendable, not how long the wait is.
    const revived = new SyncEngine<StoredRecord>({
      outbox,
      transport: httpTransport<StoredRecord>({ fetch: flaky }),
      repositories,
      clock: systemClock(),
      ids: { next: () => encodeUlid(Date.now()) },
      deviceId: "test-device",
    });

    const sent = await revived.push();
    expect(sent.pushed).toBe(1);
    expect(await outbox.pending()).toHaveLength(0);
  }, 60_000);
});

describe("a server whose migrations have not been run", () => {
  /**
   * The state this farm's deploy was actually in, reproduced.
   *
   * Migrations 0006 onwards add `breeding_records`, `calving_records`,
   * `weight_records` and more besides. They were committed and deployed and
   * never applied, so the tables the newest screens write to did not exist on
   * the server.
   *
   * What matters is which part of the queue that costs, and there are two
   * answers rather than one. A **missing table** rejects its own entries. A
   * table that exists but is behind — `animals` gained `died_on` in 0013 —
   * also rejects its own entries, because the server reads every column it
   * knows about. Neither wedges the queue: an entry for a table that is fully
   * migrated still goes. That is the property worth protecting, because
   * without it one unrun migration would stop a phone in a barn from
   * recording anything at all.
   */
  it("rejects the entries whose table is missing or behind, and takes the rest", async () => {
    const db = await freshServer(6); // 0000..0005: no breeding_records.
    const stack = localStack(db);

    // The control: an entry whose table is fully migrated at this baseline, so
    // it is the one that has to go through whatever else is behind.
    //
    // It must be a table **nothing has altered since 0005**, which is a moving
    // target — this was `zones` until 0022 added the Pasture's cross-fence to
    // it, at which point the control quietly became a third behind-table case
    // and the test failed for the right reason. If it fails that way again,
    // the fix is to move it to another untouched table, not to loosen the
    // assertion.
    await stack.engine.enqueue("create", {
      entity: "zoneAssignments",
      recordId: encodeUlid(29) as Ulid,
      changes: [
        { field: "propertyId", value: PROPERTY as never, at: now, deviceId: "test-device" },
        { field: "createdAt", value: now as never, at: now, deviceId: "test-device" },
        { field: "updatedAt", value: now as never, at: now, deviceId: "test-device" },
        { field: "animalId", value: encodeUlid(28) as never, at: now, deviceId: "test-device" },
        { field: "zoneId", value: encodeUlid(27) as never, at: now, deviceId: "test-device" },
        { field: "periodFrom", value: now as never, at: now, deviceId: "test-device" },
        { field: "slot", value: "outside" as never, at: now, deviceId: "test-device" },
      ],
    });

    // An animal: the table exists at 0005 but is two columns behind.
    const cow = animal(encodeUlid(30) as Ulid, "Andromeda");
    await stack.engine.enqueue("create", {
      entity: "animals",
      recordId: cow["id"] as Ulid,
      changes: Object.keys(cow).map((field) => ({
        field,
        value: cow[field] as never,
        at: now,
        deviceId: "test-device",
      })),
    });
    await stack.engine.enqueue("create", {
      entity: "breedingRecords",
      recordId: encodeUlid(31) as Ulid,
      changes: [
        { field: "propertyId", value: PROPERTY as never, at: now, deviceId: "test-device" },
        { field: "createdAt", value: now as never, at: now, deviceId: "test-device" },
        { field: "updatedAt", value: now as never, at: now, deviceId: "test-device" },
        { field: "damId", value: cow["id"] as never, at: now, deviceId: "test-device" },
        { field: "method", value: "AI" as never, at: now, deviceId: "test-device" },
        { field: "date", value: now as never, at: now, deviceId: "test-device" },
      ],
    });

    const outcome = await stack.engine.push();

    // The zone goes. The other two do not, and each says why.
    expect(outcome.pushed).toBe(1);
    expect(outcome.rejected).toBe(2);

    const left = await stack.outbox.pending();
    expect(left.map((entry) => entry.patch.entity).sort()).toEqual(["animals", "breedingRecords"]);
    // The reason is kept on each entry, which is what makes "3 not sent"
    // answerable rather than a number somebody can only stare at — and here
    // the two reasons differ, which is the whole diagnosis.
    const reasons = left.map((entry) => entry.lastError ?? "").join(" ");
    expect(reasons).toMatch(/breeding_records/);
    expect(reasons).toMatch(/died_on|cause_of_death/);
  }, 60_000);

  it("sends the held-back entries once the migration is applied", async () => {
    // Nothing is lost while the schema is behind: running the migration is the
    // whole fix, and the queue drains on the next sync without anybody
    // re-entering anything.
    const pg = new PGlite();
    const apply = async (from: number, to: number) => {
      for (const file of migrationFiles().slice(from, to)) {
        for (const statement of readFileSync(join(MIGRATIONS, file), "utf8")
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter((s) => s !== "")) {
          await pg.exec(statement);
        }
      }
    };

    await apply(0, 6);
    const db = drizzle(pg) as unknown as Database;
    const stack = localStack(db);

    await stack.engine.enqueue("create", {
      entity: "breedingRecords",
      recordId: encodeUlid(40) as Ulid,
      changes: [
        { field: "propertyId", value: PROPERTY as never, at: now, deviceId: "test-device" },
        { field: "createdAt", value: now as never, at: now, deviceId: "test-device" },
        { field: "updatedAt", value: now as never, at: now, deviceId: "test-device" },
        { field: "damId", value: encodeUlid(30) as never, at: now, deviceId: "test-device" },
        { field: "method", value: "AI" as never, at: now, deviceId: "test-device" },
        { field: "date", value: now as never, at: now, deviceId: "test-device" },
      ],
    });

    expect((await stack.engine.push()).rejected).toBe(1);
    expect(await stack.outbox.pending()).toHaveLength(1);

    await apply(6, migrationFiles().length);

    // A fresh engine so the connection backoff is not what is being measured.
    const after = new SyncEngine<StoredRecord>({
      outbox: stack.outbox,
      transport: httpTransport<StoredRecord>({ fetch: serverFetch(db) }),
      repositories: stack.repositories,
      clock: systemClock(),
      ids: { next: () => encodeUlid(Date.now()) },
      deviceId: "test-device",
    });

    expect((await after.push()).pushed).toBe(1);
    expect(await stack.outbox.pending()).toHaveLength(0);
  }, 60_000);
});
