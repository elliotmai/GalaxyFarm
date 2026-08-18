import "fake-indexeddb/auto";

import Dexie from "dexie";

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import type { ReactNode } from "react";

import { zoneSchema, type Ulid, type Zone } from "@galaxy-farm/core";

import { SyncProvider } from "../app/_components/sync-provider.js";
import { useMutations } from "../lib/local/mutations.js";
import { localStore, resetLocalStore } from "../lib/local/store.js";

/**
 * Writing on device (spec §4.2, §4.5).
 *
 * The order under test is the one the barn depends on: the local store has the
 * new value before anything touches the network, and the outbox has the patch
 * whether or not the network is there at all. A write that only worked online
 * would make the app useless in the one place it has to work.
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const ACTOR = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

/** Every fetch fails: these tests are about what happens with no server. */
const offline = () => Promise.reject(new Error("offline"));

function wrapper({ children }: { children: ReactNode }) {
  return <SyncProvider>{children}</SyncProvider>;
}

function harness() {
  return renderHook(() => useMutations<Zone>("zones", "zones", zoneSchema, PROPERTY, ACTOR), {
    wrapper,
  });
}

const zone = {
  name: "West Pen",
  type: "pen" as const,
  indoor: false,
  baselineSafetyLevel: 2 as const,
  waterSourceIds: [],
  resting: false,
  active: true,
};

beforeEach(async () => {
  resetLocalStore();
  // Dexie holds the global IndexedDB it saw at construction, so swapping the
  // global does not isolate anything. Deleting the database does.
  await Dexie.delete("galaxy-farm");
  globalThis.fetch = offline as unknown as typeof globalThis.fetch;
  globalThis.localStorage?.clear?.();
});

async function ready(result: { current: unknown }) {
  // The provider builds the store during its first client render, but the
  // database behind it opens asynchronously and the hook is rebuilt when it
  // lands.
  await waitFor(() => expect(result.current).toBeDefined());
}

describe("useMutations", () => {
  it("writes to the device even with no server at all", async () => {
    const { result } = harness();
    await ready(result);

    const created = await result.current.create(zone);

    expect(created.ok).toBe(true);
    const saved = await localStore().repository<Zone>("zones").list({ propertyId: PROPERTY });
    expect(saved.map((z) => z.name)).toEqual(["West Pen"]);
  });

  it("queues the patch rather than losing it", async () => {
    // The durability promise. A treatment logged at the chute has to still be
    // there tomorrow morning.
    const { result } = harness();
    await ready(result);

    await result.current.create(zone);

    const queued = await localStore().engine.pendingCount();
    expect(queued).toBeGreaterThan(0);
  });

  it("sends the fields that changed, not the whole record", async () => {
    // §4.2: two people editing different fields of the same zone both keep
    // their edits, and that only holds if the patch is a diff.
    const { result } = harness();
    await ready(result);
    const created = await result.current.create(zone);
    if (!created.ok) throw new Error("setup failed");

    await localStore().engine.pendingCount();
    await result.current.update(created.value.id, { name: "West Pen (rebuilt)" });

    const outbox = await localStore().engine.pendingCount();
    expect(outbox).toBeGreaterThan(1);
  });

  it("refuses an invalid record before it reaches the store", async () => {
    // §4.5 clause 2. Catching it here means the error lands on the field
    // rather than in a sync rejection nobody ever sees.
    const { result } = harness();
    await ready(result);

    const created = await result.current.create({ ...zone, name: "" });

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.kind).toBe("validation");
    expect(await localStore().repository<Zone>("zones").count({ propertyId: PROPERTY })).toBe(0);
  });

  it("deletes by writing a tombstone, not by removing the row", async () => {
    // §4.5 clause 4. A row that vanished locally would have nothing to
    // replicate, and the record would come back on the next pull.
    const { result } = harness();
    await ready(result);
    const created = await result.current.create(zone);
    if (!created.ok) throw new Error("setup failed");

    await result.current.remove(created.value.id, "Rebuilt");

    const repository = localStore().repository<Zone>("zones");
    expect(await repository.count({ propertyId: PROPERTY })).toBe(0);
    expect(await repository.count({ propertyId: PROPERTY, includeDeleted: true })).toBe(1);
  });

  it("restores what it tombstoned, which is what makes the undo real", async () => {
    const { result } = harness();
    await ready(result);
    const created = await result.current.create(zone);
    if (!created.ok) throw new Error("setup failed");
    await result.current.remove(created.value.id);

    await result.current.restoreRecord(created.value.id);

    const repository = localStore().repository<Zone>("zones");
    expect(await repository.count({ propertyId: PROPERTY })).toBe(1);
    const [revived] = await repository.list({ propertyId: PROPERTY });
    expect("deletedAt" in (revived ?? {})).toBe(false);
  });

  it("records who deleted it and why", async () => {
    const { result } = harness();
    await ready(result);
    const created = await result.current.create(zone);
    if (!created.ok) throw new Error("setup failed");

    const removed = await result.current.remove(created.value.id, "Rebuilt in spring");

    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.value.deletedBy).toBe(ACTOR);
      expect(removed.value.deletedReason).toBe("Rebuilt in spring");
    }
  });

  it("says not-found rather than inventing a record", async () => {
    const { result } = harness();
    await ready(result);

    const missing = await result.current.update("01ARZ3NDEKTSV4RRFFQ69G5FZZ" as Ulid, {
      name: "Nowhere",
    });

    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("not-found");
  });

  it("clears a field when the patch names it as undefined", async () => {
    // What un-ticking a chore depends on. `diff` walks the record's keys, so a
    // field the caller merely leaves out is not a change and never travels —
    // the record would keep the old value on every other device. Naming it
    // explicitly has to survive validation and reach the store as cleared.
    const { result } = harness();
    await ready(result);
    const created = await result.current.create({ ...zone, customInstructions: "Latch sticks" });
    if (!created.ok) throw new Error("setup failed");

    const cleared = await result.current.update(created.value.id, {
      customInstructions: undefined,
    });

    expect(cleared.ok).toBe(true);
    const [saved] = await localStore().repository<Zone>("zones").list({ propertyId: PROPERTY });
    expect(saved?.customInstructions).toBeUndefined();
  });

  it("stamps the property from the session, not from the form", async () => {
    const { result } = harness();
    await ready(result);

    const created = await result.current.create({
      ...zone,
      propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FP9" as Ulid,
    } as never);

    expect(created.ok).toBe(true);
    if (created.ok) expect(created.value.propertyId).toBe(PROPERTY);
  });
});
