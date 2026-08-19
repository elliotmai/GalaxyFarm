import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, type QueuedPhoto, type Ulid } from "@galaxy-farm/core";

import { FarmDatabase, UPLOADS_SCHEMA_VERSION, UPLOADS_STORE } from "../src/database.js";
import { DexiePhotoQueue } from "../src/dexie-photo-queue.js";

/**
 * The durability tests for the photo queue (spec §4.2).
 *
 * This is the half of the promise the `Attachment` record cannot keep on its
 * own. The record says a photograph exists the moment the shutter closes;
 * these are the only bytes of it there are until an upload lands, and if they
 * did not survive the browser being killed the record would point at an object
 * that never arrives — a broken tile forever, rather than a photo that has not
 * gone yet. So the tests close the database and reopen it against the same
 * storage, which is as near to a force-quit as a test gets.
 */

const at = new Date("2026-06-01T10:00:00Z");
const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA9" as Ulid;

const ids = [
  "01ARZ3NDEKTSV4RRFFQ69G5FA1",
  "01ARZ3NDEKTSV4RRFFQ69G5FA2",
  "01ARZ3NDEKTSV4RRFFQ69G5FA3",
] as unknown as Ulid[];

const photo = (id: Ulid, overrides: Partial<QueuedPhoto> = {}): QueuedPhoto => ({
  id,
  propertyId: PROPERTY,
  ownerEntity: "Animal",
  ownerId: ANIMAL,
  filename: "calf.jpg",
  contentType: "image/jpeg",
  body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  queuedAt: at,
  attempts: 0,
  ...overrides,
});

let storage = new IDBFactory();
const open: FarmDatabase[] = [];

function openDatabase(): FarmDatabase {
  const db = new FarmDatabase({
    name: "photo-queue-durability",
    stores: [],
    schemaVersion: UPLOADS_SCHEMA_VERSION,
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

describe("the upload queue's table", () => {
  it("exists at the version that introduced it", () => {
    expect(openDatabase().table(UPLOADS_STORE)).toBeDefined();
  });
});

describe("DexiePhotoQueue", () => {
  it("queues and counts", async () => {
    const queue = new DexiePhotoQueue(openDatabase());

    await queue.append(photo(ids[0]!));

    expect(await queue.size()).toBe(1);
  });

  it("survives the app being killed before there is ever any signal", async () => {
    const first = openDatabase();
    await new DexiePhotoQueue(first).append(photo(ids[0]!));
    first.close();

    const reopened = new DexiePhotoQueue(openDatabase());

    expect(await reopened.size()).toBe(1);
  });

  it("gives the bytes back unchanged, to the byte", async () => {
    // A photograph that comes back mangled is worse than one that is lost: it
    // uploads, and nobody finds out until they look at it.
    const first = openDatabase();
    const original = photo(ids[0]!, { body: new Uint8Array([0, 1, 2, 250, 251, 252]) });
    await new DexiePhotoQueue(first).append(original);
    first.close();

    const [restored] = await new DexiePhotoQueue(openDatabase()).pending();

    expect(restored?.body).toBeInstanceOf(Uint8Array);
    expect([...(restored?.body ?? [])]).toEqual([0, 1, 2, 250, 251, 252]);
    expect(restored?.filename).toBe("calf.jpg");
    expect(restored?.contentType).toBe("image/jpeg");
    expect(restored?.queuedAt).toEqual(at);
  });

  it("hands them back oldest first, which is the order they were taken in", async () => {
    const queue = new DexiePhotoQueue(openDatabase());
    await queue.append(photo(ids[2]!));
    await queue.append(photo(ids[0]!));
    await queue.append(photo(ids[1]!));

    expect((await queue.pending()).map((entry) => entry.id)).toEqual(ids);
  });

  it("takes a batch off the front rather than the whole morning", async () => {
    const queue = new DexiePhotoQueue(openDatabase());
    for (const id of ids) await queue.append(photo(id));

    expect((await queue.pending(2)).map((entry) => entry.id)).toEqual([ids[0], ids[1]]);
  });

  it("replaces an entry rather than queueing the same photo twice", async () => {
    // Re-queuing after an ambiguous failure must not upload the bytes again.
    const queue = new DexiePhotoQueue(openDatabase());
    await queue.append(photo(ids[0]!));
    await queue.append(photo(ids[0]!, { filename: "calf-2.jpg" }));

    expect(await queue.size()).toBe(1);
    expect((await queue.pending())[0]?.filename).toBe("calf-2.jpg");
  });

  it("lets go of the bytes once they are in the bucket", async () => {
    const queue = new DexiePhotoQueue(openDatabase());
    await queue.append(photo(ids[0]!));
    await queue.append(photo(ids[1]!));

    await queue.settle([ids[0]!]);

    expect((await queue.pending()).map((entry) => entry.id)).toEqual([ids[1]]);
  });

  it("settles nothing when asked for nothing", async () => {
    const queue = new DexiePhotoQueue(openDatabase());
    await queue.append(photo(ids[0]!));

    await queue.settle([]);

    expect(await queue.size()).toBe(1);
  });

  it("counts a refusal against the photo and remembers why", async () => {
    const queue = new DexiePhotoQueue(openDatabase());
    await queue.append(photo(ids[0]!));

    await queue.fail(ids[0]!, "422 unsupported type");

    const [entry] = await queue.pending();
    expect(entry?.attempts).toBe(1);
    expect(entry?.lastError).toBe("422 unsupported type");
  });

  it("records an outage without counting it against the photo", async () => {
    // A server that was down is not a verdict on a photograph. Counting it is
    // how a morning's work goes permanently stuck during an eight-minute
    // outage.
    const queue = new DexiePhotoQueue(openDatabase());
    await queue.append(photo(ids[0]!));

    await queue.defer(ids[0]!, "Failed to fetch");

    const [entry] = await queue.pending();
    expect(entry?.attempts).toBe(0);
    expect(entry?.lastError).toBe("Failed to fetch");
  });

  it("ignores a failure reported for a photo that is already gone", async () => {
    const queue = new DexiePhotoQueue(openDatabase());

    await expect(queue.fail(ids[0]!, "late")).resolves.toBeUndefined();
    await expect(queue.defer(ids[0]!, "late")).resolves.toBeUndefined();
    await expect(queue.revive([ids[0]!])).resolves.toBeUndefined();
  });

  it("sets a photo aside once it has been refused too often", async () => {
    const queue = new DexiePhotoQueue(openDatabase());
    await queue.append(photo(ids[0]!, { attempts: MAX_ATTEMPTS }));
    await queue.append(photo(ids[1]!));

    expect((await queue.stuck()).map((entry) => entry.id)).toEqual([ids[0]]);
  });

  it("puts a set-aside photo back when somebody asks it to try again", async () => {
    const queue = new DexiePhotoQueue(openDatabase());
    await queue.append(photo(ids[0]!, { attempts: MAX_ATTEMPTS, lastError: "403" }));

    await queue.revive([ids[0]!]);

    expect(await queue.stuck()).toEqual([]);
    expect((await queue.pending())[0]?.attempts).toBe(0);
  });
});
