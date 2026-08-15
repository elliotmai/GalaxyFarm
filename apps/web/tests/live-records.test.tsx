import "fake-indexeddb/auto";

import Dexie from "dexie";

import { render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { DexieRepository } from "@galaxy-farm/infra-local";
import type { Ulid, Zone } from "@galaxy-farm/core";

import { SyncProvider } from "../app/_components/sync-provider.js";
import { IDLE_MS, queryKey, snapshotFor } from "../lib/local/live-records.js";
import { localStore, resetLocalStore } from "../lib/local/store.js";
import { useRecord, useRecords } from "../lib/local/use-records.js";

/**
 * Reading on device, shared (spec §4.2).
 *
 * What is under test here is not "the rows come back" — `dexie-repository`'s
 * own suite covers that — but the three properties that make a screen feel
 * instant rather than merely correct: two components asking one question read
 * once, a screen that has been open before draws without waiting, and the
 * sixty-second sync heartbeat does not re-render everything on the way past.
 *
 * All three are invisible when they break. The app stays correct and simply
 * gets slower, which is the kind of regression that only shows up as somebody
 * saying the barn screen "feels laggy now".
 */

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER_PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;

/** Every fetch fails: none of this should ever want the network. */
const offline = () => Promise.reject(new Error("offline"));

function wrapper({ children }: { children: ReactNode }) {
  return <SyncProvider>{children}</SyncProvider>;
}

let made = 0;
function zone(fields: Partial<Zone> = {}): Zone {
  made += 1;
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(made).padStart(2, "0")}` as Ulid,
    propertyId: PROPERTY,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    name: `Pen ${made}`,
    type: "pen",
    indoor: false,
    baselineSafetyLevel: 1,
    waterSourceIds: [],
    resting: false,
    active: true,
    ...fields,
  } as Zone;
}

async function save(record: Zone): Promise<void> {
  await localStore().repository<Zone>("zones").save(record);
}

beforeEach(async () => {
  resetLocalStore();
  // Dexie holds the global IndexedDB it saw at construction, so swapping the
  // global does not isolate anything. Deleting the database does.
  await Dexie.delete("galaxy-farm");
  globalThis.fetch = offline as unknown as typeof globalThis.fetch;
  globalThis.localStorage?.clear?.();
  made = 0;
  vi.restoreAllMocks();
});

describe("one live query per question", () => {
  it("reads once however many components ask", async () => {
    await save(zone({ name: "North Trap" }));

    const observe = vi.spyOn(DexieRepository.prototype, "observe");

    function Watcher() {
      const { records } = useRecords<Zone>("zones", { propertyId: PROPERTY });
      return <span>{records.length}</span>;
    }

    const view = render(
      <SyncProvider>
        <Watcher />
        <Watcher />
        <Watcher />
      </SyncProvider>,
    );

    await waitFor(() => expect(view.container.textContent).toBe("111"));

    // Three components, one subscription — and so one filtered, sorted read of
    // the table rather than three.
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("gives a component arriving late the answer already in hand", async () => {
    await save(zone({ name: "North Trap" }));

    const first = renderHook(() => useRecords<Zone>("zones", { propertyId: PROPERTY }), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    const second = renderHook(() => useRecords<Zone>("zones", { propertyId: PROPERTY }), {
      wrapper,
    });

    // Not `waitFor`. The point is that it is right on the very first render,
    // with no effect having run and no skeleton in between.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.records).toHaveLength(1);
  });

  it("keeps the answer after the last reader leaves, so coming back is instant", async () => {
    await save(zone({ name: "North Trap" }));

    const first = renderHook(() => useRecords<Zone>("zones", { propertyId: PROPERTY }), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const again = renderHook(() => useRecords<Zone>("zones", { propertyId: PROPERTY }), {
      wrapper,
    });

    expect(again.result.current.loading).toBe(false);
    expect(again.result.current.records.map((z) => z.name)).toEqual(["North Trap"]);
  });

  it("lets go of the reader that left, and of the query once they all have", async () => {
    /*
     * The bookkeeping under the idle window, asserted through the thing it
     * controls: whether the Dexie subscription is ever torn down.
     *
     * A reader that unmounts without being taken off the list is invisible
     * from the outside — React quietly ignores a store notification for a
     * fibre that has gone, so nothing looks wrong. What actually happens is
     * that the query never goes idle, because the list it is waiting to empty
     * never empties: every screen ever opened stays subscribed, and re-reads
     * its table on every write, for as long as the tab is open.
     */
    await save(zone({ name: "North Trap" }));

    let stopped = 0;
    const observe = DexieRepository.prototype.observe;
    vi.spyOn(DexieRepository.prototype, "observe").mockImplementation(function (
      this: DexieRepository<never>,
      query,
      onChange,
    ) {
      const stop = observe.call(this, query, onChange);
      return () => {
        stopped += 1;
        stop();
      };
    });

    function Watcher() {
      const { records } = useRecords<Zone>("zones", { propertyId: PROPERTY });
      return <span>{records.length}</span>;
    }

    const first = render(
      <SyncProvider>
        <Watcher />
      </SyncProvider>,
    );
    const second = render(
      <SyncProvider>
        <Watcher />
      </SyncProvider>,
    );
    await waitFor(() => expect(second.container.textContent).toBe("1"));

    // Only `setTimeout`, so Dexie's own promises still settle normally.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      first.unmount();
      vi.advanceTimersByTime(IDLE_MS * 2);
      // One reader is still watching, so nothing is torn down.
      expect(stopped).toBe(0);

      second.unmount();
      // Still nothing: the window is what makes a navigation free, since the
      // outgoing screen unmounts before the incoming one asks the same thing.
      expect(stopped).toBe(0);

      vi.advanceTimersByTime(IDLE_MS * 2);
      expect(stopped).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spells the same question the same way however it is written", () => {
    // `{ propertyId }` and `{ propertyId, includeDeleted: false }` are one
    // question. Two keys would be two live queries over one table, both
    // returning the same rows.
    expect(queryKey("zones", { propertyId: PROPERTY })).toBe(
      queryKey("zones", { propertyId: PROPERTY, includeDeleted: false }),
    );
    expect(queryKey("zones", { propertyId: PROPERTY, search: "  " })).toBe(
      queryKey("zones", { propertyId: PROPERTY }),
    );
    expect(queryKey("zones", { propertyId: PROPERTY, includeDeleted: true })).not.toBe(
      queryKey("zones", { propertyId: PROPERTY }),
    );
    expect(queryKey("zones", { propertyId: PROPERTY })).not.toBe(
      queryKey("zones", { propertyId: OTHER_PROPERTY }),
    );
  });
});

describe("a re-run is not a change", () => {
  it("does not re-render when the table changed but the answer did not", async () => {
    await save(zone({ name: "North Trap" }));

    let renders = 0;
    function Watcher() {
      renders += 1;
      const { records } = useRecords<Zone>("zones", { propertyId: PROPERTY });
      return <span>{records.length}</span>;
    }

    const view = render(
      <SyncProvider>
        <Watcher />
      </SyncProvider>,
    );
    await waitFor(() => expect(view.container.textContent).toBe("1"));

    const settled = renders;

    // A row for somebody else's property. Dexie re-runs every query over the
    // table, this one included — and its answer is unchanged, which is what a
    // sync pull looks like from the point of view of most screens.
    await save(zone({ propertyId: OTHER_PROPERTY, name: "Not ours" }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(view.container.textContent).toBe("1");
    expect(renders).toBe(settled);
  });

  it("still re-renders when a row it is watching moves", async () => {
    const north = zone({ name: "North Trap" });
    await save(north);

    const { result } = renderHook(() => useRecords<Zone>("zones", { propertyId: PROPERTY }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await save({ ...north, name: "North Pasture", updatedAt: new Date("2026-02-01") });

    await waitFor(() => expect(result.current.records[0]?.name).toBe("North Pasture"));
  });

  it("notices a row leaving for Trash, which does not change the row count alone", async () => {
    const north = zone({ name: "North Trap" });
    const west = zone({ name: "West Pen" });
    await save(north);
    await save(west);

    const { result } = renderHook(() => useRecords<Zone>("zones", { propertyId: PROPERTY }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.records).toHaveLength(2));

    await save({ ...west, deletedAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-01") });

    await waitFor(() => expect(result.current.records.map((z) => z.name)).toEqual(["North Trap"]));
  });
});

describe("watching one record", () => {
  it("shares the read and answers a second asker immediately", async () => {
    const north = zone({ name: "North Trap" });
    await save(north);

    const observe = vi.spyOn(DexieRepository.prototype, "observeById");

    const first = renderHook(() => useRecord<Zone>("zones", north.id), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    const second = renderHook(() => useRecord<Zone>("zones", north.id), { wrapper });

    expect(second.result.current.record?.name).toBe("North Trap");
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("stays loading with no id to watch", () => {
    const { result } = renderHook(() => useRecord<Zone>("zones", undefined), { wrapper });

    expect(result.current.loading).toBe(true);
    expect(result.current.record).toBeUndefined();
  });
});

describe("resetting", () => {
  it("forgets rows read out of a store that no longer exists", async () => {
    await save(zone({ name: "North Trap" }));

    const { result, unmount } = renderHook(
      () => useRecords<Zone>("zones", { propertyId: PROPERTY }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();

    const key = queryKey("zones", { propertyId: PROPERTY });
    expect(snapshotFor(key).loading).toBe(false);

    resetLocalStore();

    expect(snapshotFor(key).loading).toBe(true);
    expect(snapshotFor(key).records).toEqual([]);
  });
});
