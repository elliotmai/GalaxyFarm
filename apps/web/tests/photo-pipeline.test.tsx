import "fake-indexeddb/auto";

import Dexie from "dexie";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import { storageKey, type Attachment, type Ulid } from "@galaxy-farm/core";

import { DexieOutbox } from "@galaxy-farm/infra-local";

import { SyncProvider, useSyncEngine } from "../app/_components/sync-provider.js";
import { localStore, resetLocalStore } from "../lib/local/store.js";
import { photoUploader } from "../lib/photos/uploader.js";
import { usePhotos } from "../lib/photos/use-photos.js";
import type { ImageCodec } from "../lib/photos/compress.js";

/**
 * A photograph taken in a pen, end to end (spec §4.2, issue #9).
 *
 * The acceptance criterion is "photos taken in the barn with no signal upload
 * later, without the user doing anything", and every part of that sentence is
 * asserted here against the real machinery: the real IndexedDB queue, the real
 * outbox, the real HTTP transport, and the real uploader on the real sync
 * heartbeat. The only thing faked is the canvas, because jsdom has none — and
 * a canvas is not what this is about.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const ANIMAL = "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid;

/** Straight through: what a small photo already inside the limits produces. */
const codec: ImageCodec = {
  async shrink() {
    return {
      body: new Uint8Array([137, 80, 78, 71]),
      source: { width: 4032, height: 3024 },
      drawn: { width: 2048, height: 1536 },
    };
  },
};

function photoFile(name = "IMG_0421.jpg"): File {
  const bytes = new Uint8Array(3_000_000);
  const file = new File([bytes], name, { type: "image/jpeg" });

  // jsdom's Blob predates `arrayBuffer()`, which every browser has had for
  // years and which is how the original bytes are read. Filled in here rather
  // than worked around in the code under test.
  if (typeof file.arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.resolve(bytes.buffer),
    });
  }

  return file;
}

function wrapper({ children }: { children: ReactNode }) {
  return <SyncProvider>{children}</SyncProvider>;
}

function harness() {
  return renderHook(
    () => ({
      library: usePhotos({
        propertyId: PROPERTY,
        actorId: ACTOR,
        ownerEntity: "Animal",
        ownerId: ANIMAL,
        compression: { codec },
      }),
      engine: useSyncEngine(),
    }),
    { wrapper },
  );
}

/**
 * One `fetch`, swapped behind rather than replaced.
 *
 * The transports bind `globalThis.fetch` when they are constructed, which is
 * what a browser does too — so a test that reassigns the global afterwards is
 * testing nothing. This is the shape that matches reality: the same function
 * throughout, with the signal coming and going behind it.
 */
let network: (url: string, init?: RequestInit) => Promise<Response>;

/** Every request fails: this is the barn. */
const noSignal = () => Promise.reject(new Error("Failed to fetch"));

interface Seen {
  readonly presigned: unknown[];
  readonly put: number;
  readonly pushed: unknown[];
}

/** A server that answers: the drive back up to the house. */
function withSignal(seen: Seen): (url: string, init?: RequestInit) => Promise<Response> {
  return (url: string, init?: RequestInit) => {
    // Only our own routes are handed JSON; the bytes go to the bucket as a
    // buffer, and parsing that as text is how a fake server invents an outage.
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    if (url === "/api/storage/presign") {
      (seen.presigned as unknown[]).push(body);
      return Promise.resolve(
        Response.json({
          url: "https://bucket.example/signed-put",
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          expiresAt: new Date("2026-06-01T10:15:00Z").toISOString(),
          // The key the *server* derived. The device derived the same one.
          key: storageKey({
            propertyId: PROPERTY,
            entity: "Animal",
            recordId: ANIMAL,
            attachmentId: (body as { attachmentId: string }).attachmentId,
            filename: (body as { filename: string }).filename,
          }),
        }),
      );
    }

    if (url === "https://bucket.example/signed-put") {
      (seen as { put: number }).put += 1;
      return Promise.resolve(new Response(null, { status: 200 }));
    }

    if (url === "/api/sync/push") {
      const entries = (body as { entries: { id: string }[] }).entries;
      (seen.pushed as unknown[]).push(...entries);
      return Promise.resolve(
        Response.json({ accepted: entries.map((entry) => entry.id), rejected: [], audit: [] }),
      );
    }

    return Promise.resolve(Response.json({ pages: [] }));
  };
}

beforeEach(async () => {
  resetLocalStore();
  await Dexie.delete("galaxy-farm");
  network = noSignal;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    network(url, init)) as unknown as typeof globalThis.fetch;
  globalThis.localStorage?.clear?.();

  // jsdom has no object URLs, and the gallery mints one per queued photo so
  // that a photo taken with no signal is still visible.
  const urls = globalThis.URL as unknown as {
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
  urls.createObjectURL = () => "blob:photo";
  urls.revokeObjectURL = () => {};
});

async function ready(result: { current: { library: { loading: boolean } } }) {
  await waitFor(() => expect(result.current.library.loading).toBe(false));
}

/**
 * Let the write's own fire-and-forget sync finish.
 *
 * Attaching a photo prods the sync loop rather than awaiting it — putting the
 * network in front of the person is the one thing this design will not do — so
 * a run is still in flight when `attach` returns, and the loop takes one at a
 * time. A heartbeat arriving mid-run is dropped on a real device too; here it
 * would just make the test assert nothing.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function attachments(): Promise<Attachment[]> {
  return localStore().repository<Attachment>("attachments").list({ propertyId: PROPERTY });
}

describe("a photo taken with no signal at all", () => {
  it("is attached to the animal, then and there", async () => {
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    const [saved] = await attachments();
    expect(saved?.ownerEntity).toBe("Animal");
    expect(saved?.ownerId).toBe(ANIMAL);
    expect(saved?.filename).toBe("IMG_0421.jpg");
  });

  it("stores the key immediately, with nothing to ask", async () => {
    // §4.2: "records store the key immediately and render a placeholder until
    // synced". There is no server here to issue one, so it is derived.
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    const [saved] = await attachments();
    expect(saved?.key).toBe(
      storageKey({
        propertyId: PROPERTY,
        entity: "Animal",
        recordId: ANIMAL,
        attachmentId: saved?.id ?? ("" as Ulid),
        filename: "IMG_0421.jpg",
      }),
    );
  });

  it("shows as a placeholder rather than as a photograph that has arrived", async () => {
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    await waitFor(() => expect(result.current.library.photos).toHaveLength(1));
    expect(result.current.library.photos[0]?.pending).toBe(true);
    expect(result.current.library.photos[0]?.attachment.uploaded).toBe(false);
  });

  it("keeps the bytes on the device, where the browser being killed cannot lose them", async () => {
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    const queued = await localStore().photoQueue.pending();
    expect(queued).toHaveLength(1);
    expect([...(queued[0]?.body ?? [])]).toEqual([137, 80, 78, 71]);
    expect(queued[0]?.contentType).toBe("image/jpeg");
  });

  it("queues the record's own patch too, so the animal knows about it", async () => {
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    const outbox = await localStore().engine.pendingCount();
    expect(outbox).toBeGreaterThan(0);
  });

  it("still shows the picture, read back out of the queue", async () => {
    // Not merely a grey box. The photograph is on the device and there is no
    // reason somebody standing in the pen should not be able to see it.
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    await waitFor(() => expect(result.current.library.photos[0]?.src).toBe("blob:photo"));
  });

  it("leaves no orphan bytes when the record itself cannot be saved", async () => {
    // The other half of "bytes first": if the record is refused, the queue has
    // to let go of them, or the device carries a photograph nothing points at
    // for the rest of its life.
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile(`${"n".repeat(300)}.jpg`)]);
    });

    expect(result.current.library.problem).toContain("could not be attached");
    expect(await attachments()).toEqual([]);
    expect(await localStore().photoQueue.size()).toBe(0);
  });

  it("says so about a file that is not a photograph, and attaches nothing", async () => {
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([
        new File([new Uint8Array(10)], "barn.mov", { type: "video/quicktime" }),
      ]);
    });

    expect(result.current.library.problem).toContain("barn.mov");
    expect(await attachments()).toEqual([]);
    expect(await localStore().photoQueue.size()).toBe(0);
  });
});

describe("and then the signal comes back", () => {
  it("uploads it with nobody doing anything", async () => {
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    await settle();

    const seen: Seen = { presigned: [], put: 0, pushed: [] };
    network = withSignal(seen);

    // The heartbeat. Nobody has touched a thing since the photo was taken.
    await act(async () => {
      await result.current.engine.syncNow();
    });

    expect(seen.put).toBe(1);
    expect(await localStore().photoQueue.size()).toBe(0);
  });

  it("flips the record, so every other device stops showing a placeholder", async () => {
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    await settle();
    network = withSignal({ presigned: [], put: 0, pushed: [] });
    await act(async () => {
      await result.current.engine.syncNow();
    });

    const [saved] = await attachments();
    expect(saved?.uploaded).toBe(true);
  });

  it("queues that flip through the outbox like any other change", async () => {
    // The kiosk in the barn learns the photo has landed the same way it learns
    // an animal moved pen: a field patch in the outbox, merged last-write-wins
    // on the server. Asserted on the queue rather than on a request, because
    // when the push actually goes out is the engine's own backoff to decide.
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    await settle();
    network = withSignal({ presigned: [], put: 0, pushed: [] });
    await act(async () => {
      await result.current.engine.syncNow();
    });

    const queued = await new DexieOutbox(localStore().db).pending();
    // The *update*, not the create it was queued with. A create carries every
    // field including `uploaded: false`, so asserting on the field alone would
    // pass without anything having been uploaded at all.
    const flips = queued.filter(
      (entry) => entry.patch.entity === "attachments" && entry.operation === "update",
    );

    expect(flips).toHaveLength(1);
    expect(flips[0]?.patch.changes.map((change) => change.field)).toContain("uploaded");
    expect(flips[0]?.patch.changes.find((change) => change.field === "uploaded")?.value).toBe(true);
  });

  it("asks for a key by naming the record, never by naming a key", async () => {
    // A client that can name its own key can write into another property's
    // prefix. The request has no field for one.
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    await settle();

    const seen: Seen = { presigned: [], put: 0, pushed: [] };
    network = withSignal(seen);
    await act(async () => {
      await result.current.engine.syncNow();
    });

    expect(seen.presigned[0]).toMatchObject({ ownerEntity: "Animal", ownerId: ANIMAL });
    expect(seen.presigned[0]).not.toHaveProperty("key");
    expect(seen.presigned[0]).not.toHaveProperty("propertyId");
  });

  it("shows the placeholder again if the signal goes before the tile can be signed", async () => {
    // The bucket is private, so even drawing a photo that has landed needs a
    // signed URL. Not having one is not an error — it is the truth, said
    // quietly, on a device that cannot reach the server just now.
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    await settle();
    network = withSignal({ presigned: [], put: 0, pushed: [] });
    await act(async () => {
      await result.current.engine.syncNow();
    });

    network = noSignal;
    await settle();

    await waitFor(() => expect(result.current.library.photos[0]?.pending).toBe(false));
    expect(result.current.library.photos[0]?.src).toBeUndefined();
  });

  it("does not choke on bytes with no record pointing at them", async () => {
    // Rare, and worth surviving: a queue entry whose attachment never made it
    // to the store. There is nothing to flip, so the drain settles it and
    // forgets it rather than retrying a record that does not exist.
    harness();
    network = withSignal({ presigned: [], put: 0, pushed: [] });

    await waitFor(() => expect(localStore().photoQueue).toBeDefined());
    await localStore().photoQueue.append({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FB9" as Ulid,
      propertyId: PROPERTY,
      ownerEntity: "Animal",
      ownerId: ANIMAL,
      filename: "orphan.jpg",
      contentType: "image/jpeg",
      body: new Uint8Array([1, 2, 3]),
      queuedAt: new Date(),
      attempts: 0,
    });

    const outcome = await photoUploader(localStore()).drain();

    expect(outcome).toMatchObject({ uploaded: 1, offline: false });
    expect(await localStore().photoQueue.size()).toBe(0);
    expect(await attachments()).toEqual([]);
  });

  it("leaves nothing behind for the next heartbeat to send twice", async () => {
    const { result } = harness();
    await ready(result);

    await act(async () => {
      await result.current.library.attach([photoFile()]);
    });

    await settle();

    const seen: Seen = { presigned: [], put: 0, pushed: [] };
    network = withSignal(seen);
    await act(async () => {
      await result.current.engine.syncNow();
    });
    await act(async () => {
      await result.current.engine.syncNow();
    });

    expect(seen.put).toBe(1);
  });
});
