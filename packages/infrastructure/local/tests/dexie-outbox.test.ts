import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import type { OutboxEntry, Ulid } from "@galaxy-farm/core";

import { FarmDatabase } from "../src/database.js";
import { DexieOutbox, OUTBOX_STORE } from "../src/dexie-outbox.js";

/**
 * The durability tests for the outbox.
 *
 * An in-memory outbox loses everything if the app is killed, which on a phone
 * in a barn with the screen off is not hypothetical. These tests close the
 * database and reopen it against the same storage, which is as close to
 * "someone force-quit the app" as a test can get.
 */

const at = new Date("2026-06-01T10:00:00Z");
const recordId = "01ARZ3NDEKTSV4RRFFQ69G5FR1" as Ulid;

const ids = [
  "01ARZ3NDEKTSV4RRFFQ69G5FA1",
  "01ARZ3NDEKTSV4RRFFQ69G5FA2",
  "01ARZ3NDEKTSV4RRFFQ69G5FA3",
] as unknown as Ulid[];

const entry = (id: Ulid, overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id,
  operation: "update",
  patch: {
    entity: "Animal",
    recordId,
    changes: [{ field: "name", value: "Dolly", at, deviceId: "barn" }],
  },
  queuedAt: at,
  deviceId: "barn",
  attempts: 0,
  ...overrides,
});

/** One shared IndexedDB, so a reopen sees what the previous handle wrote. */
let storage = new IDBFactory();
const open: FarmDatabase[] = [];

function openDatabase(): FarmDatabase {
  const db = new FarmDatabase({
    name: "outbox-durability",
    stores: [OUTBOX_STORE],
    indexedDB: storage,
    iDBKeyRange: FakeIDBKeyRange as unknown as typeof IDBKeyRange,
  });
  open.push(db);
  return db;
}

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  storage = new IDBFactory();
});

describe("DexieOutbox", () => {
  it("queues and counts", async () => {
    const outbox = new DexieOutbox(openDatabase());

    await outbox.append(entry(ids[0]!));

    expect(await outbox.size()).toBe(1);
  });

  it("survives the app being killed before it ever syncs", async () => {
    // The headline promise of the whole local-first design.
    const first = openDatabase();
    await new DexieOutbox(first).append(entry(ids[0]!));
    first.close();

    const reopened = new DexieOutbox(openDatabase());

    expect(await reopened.size()).toBe(1);
    expect((await reopened.pending())[0]?.id).toBe(ids[0]);
  });

  it("preserves the patch intact across a restart", async () => {
    // A patch that comes back mangled is worse than one that is lost — it
    // syncs the wrong value and nobody notices.
    const first = openDatabase();
    await new DexieOutbox(first).append(entry(ids[0]!));
    first.close();

    const [restored] = await new DexieOutbox(openDatabase()).pending();

    expect(restored?.patch.entity).toBe("Animal");
    expect(restored?.patch.changes[0]?.value).toBe("Dolly");
    expect(restored?.patch.changes[0]?.at).toBeInstanceOf(Date);
    expect(restored?.queuedAt).toBeInstanceOf(Date);
  });

  it("preserves the retry count across a restart", async () => {
    // Otherwise a device that keeps crashing retries with no backoff forever.
    const first = openDatabase();
    const outbox = new DexieOutbox(first);
    await outbox.append(entry(ids[0]!));
    await outbox.fail(ids[0]!, "no signal");
    await outbox.fail(ids[0]!, "no signal");
    first.close();

    const [restored] = await new DexieOutbox(openDatabase()).pending();

    expect(restored?.attempts).toBe(2);
    expect(restored?.lastError).toBe("no signal");
  });

  it("drains oldest first", async () => {
    const outbox = new DexieOutbox(openDatabase());
    await outbox.append(entry(ids[2]!));
    await outbox.append(entry(ids[0]!));
    await outbox.append(entry(ids[1]!));

    expect((await outbox.pending()).map((e) => e.id)).toEqual(ids);
  });

  it("limits a batch without losing the rest", async () => {
    const outbox = new DexieOutbox(openDatabase());
    for (const id of ids) await outbox.append(entry(id));

    expect(await outbox.pending(2)).toHaveLength(2);
    expect(await outbox.size()).toBe(3);
  });

  it("does not duplicate a re-appended entry", async () => {
    // A push retried after an ambiguous failure must not enqueue twice.
    const outbox = new DexieOutbox(openDatabase());
    await outbox.append(entry(ids[0]!));
    await outbox.append(entry(ids[0]!));

    expect(await outbox.size()).toBe(1);
  });

  it("acks, and acking twice is harmless", async () => {
    const outbox = new DexieOutbox(openDatabase());
    await outbox.append(entry(ids[0]!));
    await outbox.append(entry(ids[1]!));

    await outbox.ack([ids[0]!]);
    await outbox.ack([ids[0]!]);

    expect((await outbox.pending()).map((e) => e.id)).toEqual([ids[1]]);
  });

  it("ignores an empty ack", async () => {
    const outbox = new DexieOutbox(openDatabase());
    await outbox.append(entry(ids[0]!));

    await outbox.ack([]);

    expect(await outbox.size()).toBe(1);
  });

  it("ignores a failure for an entry already acknowledged", async () => {
    const outbox = new DexieOutbox(openDatabase());

    await expect(outbox.fail(ids[0]!, "gone")).resolves.toBeUndefined();
    expect(await outbox.size()).toBe(0);
  });
});
