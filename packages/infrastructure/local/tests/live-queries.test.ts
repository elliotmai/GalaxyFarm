// Installed globally rather than injected: Dexie's liveQuery change tracking
// hooks the global indexedDB, so an injected factory reads and writes fine but
// never emits. In the browser this never arises.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";

import type { BaseRecord, Ulid } from "@galaxy-farm/core";

import { FarmDatabase } from "../src/database.js";
import { DexieRepository } from "../src/dexie-repository.js";

/**
 * Live queries are what make local-first feel local.
 *
 * The Pen Board on a barn kiosk has to redraw when someone moves an animal
 * from the house — a change that arrives through a sync pull, not through
 * anything the kiosk did. A store that only notified on local writes would
 * leave every other screen stale until somebody refreshed it.
 */

interface Cow extends BaseRecord {
  readonly name: string;
}

const propertyId = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const at = new Date("2026-06-01T10:00:00Z");

const cow = (id: string, overrides: Partial<Cow> = {}): Cow => ({
  id: id as Ulid,
  propertyId,
  createdAt: at,
  updatedAt: at,
  name: "Dolly",
  ...overrides,
});

const ID_1 = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const ID_2 = "01ARZ3NDEKTSV4RRFFQ69G5FR2";

const open: FarmDatabase[] = [];
const stop: (() => void)[] = [];
let dbCounter = 0;

/** A uniquely named database per test, since they share the global store. */
async function repository(): Promise<DexieRepository<Cow>> {
  const db = new FarmDatabase({ name: `live-${dbCounter++}`, stores: ["records"] });
  await db.open();
  open.push(db);
  return new DexieRepository<Cow>(db, "records", ["name"]);
}

afterEach(() => {
  for (const unsubscribe of stop.splice(0)) unsubscribe();
  for (const db of open.splice(0)) db.close();
});

/** Waits for a subscriber to reach an expected state, or times out. */
async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for a live query update");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("observe", () => {
  it("emits the current result immediately", async () => {
    const repo = await repository();
    await repo.save(cow(ID_1));

    const seen: Cow[][] = [];
    stop.push(repo.observe({ propertyId }, (records) => seen.push(records)));

    await waitFor(() => seen.length > 0);
    expect(seen[0]?.map((c) => c.id)).toEqual([ID_1]);
  });

  it("re-emits when a record is written", async () => {
    const repo = await repository();
    const seen: Cow[][] = [];
    stop.push(repo.observe({ propertyId }, (records) => seen.push(records)));
    await waitFor(() => seen.length > 0);

    await repo.save(cow(ID_1));

    await waitFor(() => seen.at(-1)?.length === 1);
    expect(seen.at(-1)?.[0]?.id).toBe(ID_1);
  });

  it("re-emits when a sync pull writes a batch", async () => {
    // This is the case that matters: the change did not originate on this
    // device, and the screen still has to update.
    const repo = await repository();
    const seen: Cow[][] = [];
    stop.push(repo.observe({ propertyId }, (records) => seen.push(records)));
    await waitFor(() => seen.length > 0);

    await repo.saveMany([cow(ID_1), cow(ID_2)]);

    await waitFor(() => seen.at(-1)?.length === 2);
  });

  it("re-emits when a record is soft-deleted, dropping it from the result", async () => {
    const repo = await repository();
    await repo.save(cow(ID_1));
    const seen: Cow[][] = [];
    stop.push(repo.observe({ propertyId }, (records) => seen.push(records)));
    await waitFor(() => seen.at(-1)?.length === 1);

    await repo.save(cow(ID_1, { deletedAt: at, deletedBy: propertyId }));

    await waitFor(() => seen.at(-1)?.length === 0);
  });

  it("honours the query's filters", async () => {
    const repo = await repository();
    const seen: Cow[][] = [];
    stop.push(repo.observe({ propertyId, search: "hay" }, (records) => seen.push(records)));
    await waitFor(() => seen.length > 0);

    await repo.saveMany([cow(ID_1, { name: "Hay ring" }), cow(ID_2, { name: "Mineral tub" })]);

    await waitFor(() => seen.at(-1)?.length === 1);
    expect(seen.at(-1)?.[0]?.name).toBe("Hay ring");
  });

  it("stops emitting once unsubscribed", async () => {
    const repo = await repository();
    const seen: Cow[][] = [];
    const unsubscribe = repo.observe({ propertyId }, (records) => seen.push(records));
    await waitFor(() => seen.length > 0);

    unsubscribe();
    const countAtUnsubscribe = seen.length;
    await repo.save(cow(ID_1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(seen.length).toBe(countAtUnsubscribe);
  });
});

describe("observeById", () => {
  it("emits undefined for a record that does not exist yet", async () => {
    const repo = await repository();
    const seen: (Cow | undefined)[] = [];
    stop.push(repo.observeById(ID_1 as Ulid, (record) => seen.push(record)));

    await waitFor(() => seen.length > 0);
    expect(seen[0]).toBeUndefined();
  });

  it("emits when the record appears and again when it changes", async () => {
    const repo = await repository();
    const seen: (Cow | undefined)[] = [];
    stop.push(repo.observeById(ID_1 as Ulid, (record) => seen.push(record)));
    await waitFor(() => seen.length > 0);

    await repo.save(cow(ID_1, { name: "Dolly" }));
    await waitFor(() => seen.at(-1)?.name === "Dolly");

    await repo.save(cow(ID_1, { name: "Dolly II" }));
    await waitFor(() => seen.at(-1)?.name === "Dolly II");
  });

  it("does not fire for an unrelated record", async () => {
    const repo = await repository();
    const seen: (Cow | undefined)[] = [];
    stop.push(repo.observeById(ID_1 as Ulid, (record) => seen.push(record)));
    await waitFor(() => seen.length > 0);
    const before = seen.length;

    await repo.save(cow(ID_2));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Dexie may re-run the query on any table change, but the value it reports
    // for this id must not change.
    expect(seen.slice(before).every((record) => record === undefined)).toBe(true);
  });
});
