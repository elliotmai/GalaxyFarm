import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_ATTEMPTS,
  PhotoUploadRefused,
  fixedClock,
  type PhotoQueue,
  type PhotoUploadTransport,
  type PresignUploadRequest,
  type PresignedUpload,
  type QueuedPhoto,
  type Ulid,
} from "@galaxy-farm/core";

import { PhotoUploader } from "../src/photo-uploader.js";

/**
 * A photograph taken with no signal, and what happens next (spec §4.2).
 *
 * This is the acceptance criterion the whole issue turns on — "photos taken in
 * the barn with no signal upload later, without the user doing anything" — and
 * it is behaviour that only ever misbehaves on a connection that fails halfway
 * through. So the transport here is a fake that can be told to refuse, to drop
 * the connection, or to come back, which is the only way to reproduce a metal
 * barn on purpose.
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
  body: new Uint8Array([1, 2, 3, 4]),
  queuedAt: at,
  attempts: 0,
  ...overrides,
});

/** An in-memory queue with the same contract the device's IndexedDB one has. */
function memoryQueue(initial: readonly QueuedPhoto[] = []): PhotoQueue & {
  readonly rows: Map<string, QueuedPhoto>;
} {
  const rows = new Map<string, QueuedPhoto>(initial.map((entry) => [entry.id, entry]));

  return {
    rows,
    async append(entry) {
      rows.set(entry.id, entry);
    },
    async pending(limit) {
      const all = [...rows.values()].sort((left, right) => left.id.localeCompare(right.id));
      return limit === undefined ? all : all.slice(0, limit);
    },
    async settle(settled) {
      for (const id of settled) rows.delete(id);
    },
    async fail(id, error) {
      const held = rows.get(id);
      if (held !== undefined)
        rows.set(id, { ...held, attempts: held.attempts + 1, lastError: error });
    },
    async defer(id, error) {
      const held = rows.get(id);
      if (held !== undefined) rows.set(id, { ...held, lastError: error });
    },
    async size() {
      return rows.size;
    },
    async stuck() {
      return [...rows.values()].filter((entry) => entry.attempts >= MAX_ATTEMPTS);
    },
    async revive(revived) {
      for (const id of revived) {
        const held = rows.get(id);
        if (held !== undefined) rows.set(id, { ...held, attempts: 0 });
      }
    },
  };
}

interface FakeTransport extends PhotoUploadTransport {
  readonly presigned: PresignUploadRequest[];
  readonly put: PhotoUploadTransport["put"];
  readonly uploaded: string[];
  behaviour: "online" | "offline" | "refuse" | "refuse-on-put";
}

function fakeTransport(): FakeTransport {
  const presigned: PresignUploadRequest[] = [];
  const uploaded: string[] = [];

  const transport: FakeTransport = {
    behaviour: "online",
    presigned,
    uploaded,
    async presign(request) {
      if (transport.behaviour === "offline") throw new Error("Failed to fetch");
      if (transport.behaviour === "refuse") throw new PhotoUploadRefused(422, "Too large");

      presigned.push(request);
      return {
        url: `https://bucket.example/${request.attachmentId}`,
        method: "PUT",
        headers: { "Content-Type": request.contentType },
        expiresAt: new Date(at.getTime() + 900_000),
        key: `${PROPERTY}/${request.ownerEntity}/${request.ownerId}/${request.attachmentId}.jpg`,
      } satisfies PresignedUpload;
    },
    async put(upload) {
      if (transport.behaviour === "offline") throw new Error("Failed to fetch");
      if (transport.behaviour === "refuse-on-put") throw new PhotoUploadRefused(403, "Forbidden");
      uploaded.push(upload.key);
    },
  };

  return transport;
}

let flipped: { photo: QueuedPhoto; key: string }[];

function uploader(queue: PhotoQueue, transport: PhotoUploadTransport, batchSize?: number) {
  return new PhotoUploader({
    queue,
    transport,
    clock: fixedClock(at),
    onUploaded: async (uploadedPhoto, key) => {
      flipped.push({ photo: uploadedPhoto, key });
    },
    ...(batchSize === undefined ? {} : { batchSize }),
  });
}

beforeEach(() => {
  flipped = [];
});

describe("with signal", () => {
  it("uploads a queued photo and lets the queue go", async () => {
    const queue = memoryQueue([photo(ids[0]!)]);
    const transport = fakeTransport();

    const outcome = await uploader(queue, transport).drain();

    expect(outcome).toMatchObject({ uploaded: 1, refused: 0, offline: false });
    expect(await queue.size()).toBe(0);
    expect(transport.uploaded).toHaveLength(1);
  });

  it("asks for a key by the record it belongs to, never by naming one", async () => {
    const queue = memoryQueue([photo(ids[0]!)]);
    const transport = fakeTransport();

    await uploader(queue, transport).drain();

    expect(transport.presigned[0]).toEqual({
      ownerEntity: "Animal",
      ownerId: ANIMAL,
      attachmentId: ids[0],
      filename: "calf.jpg",
      contentType: "image/jpeg",
      bytes: 4,
    });
  });

  it("flips the record with the key the server signed, not the one it guessed", async () => {
    const queue = memoryQueue([photo(ids[0]!)]);

    await uploader(queue, fakeTransport()).drain();

    expect(flipped).toHaveLength(1);
    expect(flipped[0]?.key).toBe(`${PROPERTY}/Animal/${ANIMAL}/${ids[0]}.jpg`);
  });

  it("does nothing at all when there is nothing waiting", async () => {
    const transport = fakeTransport();

    const outcome = await uploader(memoryQueue(), transport).drain();

    expect(outcome).toEqual({ uploaded: 0, refused: 0, offline: false });
    expect(transport.presigned).toEqual([]);
  });

  it("sends a batch at a time rather than a whole morning at once", async () => {
    const queue = memoryQueue(ids.map((id) => photo(id)));

    const outcome = await uploader(queue, fakeTransport(), 2).drain();

    expect(outcome.uploaded).toBe(2);
    expect(await queue.size()).toBe(1);
  });

  it("keeps the bytes when the record cannot be flipped", async () => {
    // A settled queue and an unflipped record is a photo that renders as a
    // placeholder forever, which is worse than one that uploads twice.
    const queue = memoryQueue([photo(ids[0]!)]);
    const uploads = new PhotoUploader({
      queue,
      transport: fakeTransport(),
      clock: fixedClock(at),
      onUploaded: () => Promise.reject(new Error("the local store is gone")),
    });

    const outcome = await uploads.drain();

    expect(outcome.offline).toBe(true);
    expect(await queue.size()).toBe(1);
  });
});

describe("with no signal", () => {
  it("leaves the photograph queued", async () => {
    const queue = memoryQueue([photo(ids[0]!)]);
    const transport = fakeTransport();
    transport.behaviour = "offline";

    const outcome = await uploader(queue, transport).drain();

    expect(outcome).toMatchObject({ uploaded: 0, offline: true });
    expect(await queue.size()).toBe(1);
  });

  it("does not count the outage against it", async () => {
    // Retiring a morning's photographs because somebody drove out of signal is
    // the failure this rule exists to prevent.
    const queue = memoryQueue([photo(ids[0]!)]);
    const transport = fakeTransport();
    transport.behaviour = "offline";

    await uploader(queue, transport).drain();
    await uploader(queue, transport).drain();

    expect((await queue.pending())[0]?.attempts).toBe(0);
    expect(await queue.stuck()).toEqual([]);
  });

  it("abandons the rest of the batch rather than waking the radio for each", async () => {
    const queue = memoryQueue(ids.map((id) => photo(id)));
    const transport = fakeTransport();
    transport.behaviour = "offline";

    await uploader(queue, transport, 3).drain();

    expect(transport.presigned).toEqual([]);
    expect(await queue.size()).toBe(3);
  });

  it("uploads it later, with nobody doing anything", async () => {
    // The acceptance criterion, end to end: queued in a pen, drained on the
    // next heartbeat after the signal comes back.
    const queue = memoryQueue([photo(ids[0]!)]);
    const transport = fakeTransport();
    transport.behaviour = "offline";

    await uploader(queue, transport).drain();
    expect(await queue.size()).toBe(1);

    transport.behaviour = "online";
    const later = await uploader(queue, transport).drain();

    expect(later).toMatchObject({ uploaded: 1, offline: false });
    expect(await queue.size()).toBe(0);
    expect(flipped).toHaveLength(1);
  });

  it("keeps what did go up before the connection dropped mid-batch", async () => {
    const queue = memoryQueue([photo(ids[0]!), photo(ids[1]!)]);
    const transport = fakeTransport();
    let sent = 0;
    const flaky: PhotoUploadTransport = {
      presign: (request) => {
        sent += 1;
        if (sent > 1) throw new Error("Failed to fetch");
        return transport.presign(request);
      },
      put: transport.put,
    };

    const outcome = await uploader(queue, flaky, 2).drain();

    expect(outcome).toMatchObject({ uploaded: 1, offline: true });
    expect(await queue.size()).toBe(1);
    expect((await queue.pending())[0]?.id).toBe(ids[1]);
  });
});

describe("when the server refuses", () => {
  it("counts the refusal and moves on to the next photo", async () => {
    const queue = memoryQueue([photo(ids[0]!), photo(ids[1]!)]);
    const transport = fakeTransport();
    let asked = 0;
    const refusesTheFirst: PhotoUploadTransport = {
      presign: (request) => {
        asked += 1;
        if (asked === 1) throw new PhotoUploadRefused(422, "Too large");
        return transport.presign(request);
      },
      put: transport.put,
    };

    const outcome = await uploader(queue, refusesTheFirst, 2).drain();

    expect(outcome).toMatchObject({ uploaded: 1, refused: 1, offline: false });
    expect(outcome.problem).toBe("Too large");
    expect((await queue.pending())[0]?.attempts).toBe(1);
  });

  it("counts a refusal from the bucket itself the same way", async () => {
    const queue = memoryQueue([photo(ids[0]!)]);
    const transport = fakeTransport();
    transport.behaviour = "refuse-on-put";

    const outcome = await uploader(queue, transport).drain();

    expect(outcome.refused).toBe(1);
    expect((await queue.pending())[0]?.lastError).toContain("Forbidden");
  });

  it("retires a photo that will never be accepted rather than retrying forever", async () => {
    const queue = memoryQueue([photo(ids[0]!, { attempts: MAX_ATTEMPTS - 1 })]);
    const transport = fakeTransport();
    transport.behaviour = "refuse";

    await uploader(queue, transport).drain();

    expect((await queue.stuck()).map((entry) => entry.id)).toEqual([ids[0]]);
  });

  it("stops offering a retired photo, so a fresh one is not stuck behind it", async () => {
    // Head-of-line blocking: a retired entry at the front of the queue must not
    // hide the photograph somebody took a minute ago.
    const queue = memoryQueue([photo(ids[0]!, { attempts: MAX_ATTEMPTS }), photo(ids[1]!)]);
    const transport = fakeTransport();

    const outcome = await uploader(queue, transport, 1).drain();

    expect(outcome.uploaded).toBe(1);
    expect(transport.presigned[0]?.attachmentId).toBe(ids[1]);
  });
});

describe("what the badge is told", () => {
  it("counts everything still on the device", async () => {
    const queue = memoryQueue([photo(ids[0]!), photo(ids[1]!)]);

    expect(await uploader(queue, fakeTransport()).pendingCount()).toBe(2);
  });

  it("counts the set-aside ones apart, because they will not go on their own", async () => {
    const queue = memoryQueue([photo(ids[0]!, { attempts: MAX_ATTEMPTS }), photo(ids[1]!)]);

    expect(await uploader(queue, fakeTransport()).stuckCount()).toBe(1);
  });

  it("puts them all back when somebody asks it to try again", async () => {
    const queue = memoryQueue([photo(ids[0]!, { attempts: MAX_ATTEMPTS })]);
    const uploads = uploader(queue, fakeTransport());

    await uploads.retryStuck();

    expect(await uploads.stuckCount()).toBe(0);
  });
});
