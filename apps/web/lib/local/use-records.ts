"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { BaseRecord, ListQuery, Ulid } from "@galaxy-farm/core";

import { useSyncEngine } from "@/app/_components/sync-provider";
import {
  NO_RECORD,
  NO_RECORDS,
  queryKey,
  recordKey,
  recordSnapshotFor,
  snapshotFor,
  subscribeRecord,
  subscribeRecords,
  type RecordState,
  type RecordsState,
} from "@/lib/local/live-records";
import type { LocalStoreName } from "@/lib/local/store";

/**
 * Reading from the device (spec §4.2).
 *
 * These subscribe rather than fetch. Dexie's `liveQuery` re-runs the read
 * whenever the table changes, whichever way the change arrived — a local edit
 * or a sync pull writing a batch — which is the property the Pen Board depends
 * on: someone moves an animal from the house, and the kiosk in the barn
 * redraws without anybody touching it.
 *
 * `useSyncExternalStore` rather than `useState` in an effect, because the two
 * differ exactly where it is felt. An effect cannot run until after the first
 * paint, so a screen whose rows were already in hand still had to render once
 * as a skeleton and once again with its data. This reads the shared cache
 * during the render that mounts it, so a screen you have opened before draws
 * its rows immediately — see `live-records.ts` for what is shared and for how
 * long.
 */

export type { RecordState, RecordsState };

export function useRecords<T extends BaseRecord>(
  store: LocalStoreName,
  query: Omit<ListQuery, "propertyId"> & { readonly propertyId: Ulid },
): RecordsState<T> {
  const { store: local } = useSyncEngine();
  // The key *is* the query, canonically spelled, so everything below depends on
  // one string rather than on an object literal that is new on every render.
  const key = queryKey(store, query);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (local === undefined) return () => {};
      return subscribeRecords(local, key, onChange);
    },
    [local, key],
  );

  const snapshot = useCallback(() => snapshotFor(key), [key]);

  // The server has no IndexedDB, so it renders what a device with nothing
  // cached renders: loading. React uses this for the hydrating pass too, which
  // is what keeps a warm cache from tripping a hydration mismatch.
  return useSyncExternalStore(subscribe, snapshot, loading) as RecordsState<T>;
}

export function useRecord<T extends BaseRecord>(
  store: LocalStoreName,
  id: Ulid | undefined,
): RecordState<T> {
  const { store: local } = useSyncEngine();
  const key = id === undefined ? undefined : recordKey(store, id);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (local === undefined || id === undefined || key === undefined) return () => {};
      return subscribeRecord(local, store, id, key, onChange);
    },
    [local, store, id, key],
  );

  const snapshot = useCallback(
    () => (key === undefined ? oneLoading() : recordSnapshotFor(key)),
    [key],
  );

  return useSyncExternalStore(subscribe, snapshot, oneLoading) as RecordState<T>;
}

/**
 * The same two singletons the cache hands out, not fresh objects.
 *
 * `useSyncExternalStore` re-renders whenever the snapshot is not the reference
 * it saw last, and it asks for one more than once per render — a literal
 * returned from here would loop, and a second copy of the empty state would
 * make every hydration a re-render for nothing.
 */
function loading(): RecordsState<BaseRecord> {
  return NO_RECORDS;
}

function oneLoading(): RecordState<BaseRecord> {
  return NO_RECORD;
}
