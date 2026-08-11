"use client";

import { useEffect, useState } from "react";

import type { BaseRecord, ListQuery, Ulid } from "@galaxy-farm/core";

import { useSync } from "@/app/_components/sync-provider";
import type { LocalStoreName } from "@/lib/local/store";

/**
 * Reading from the device (spec §4.2).
 *
 * These subscribe rather than fetch. Dexie's `liveQuery` re-runs the read
 * whenever the table changes, whichever way the change arrived — a local edit
 * or a sync pull writing a batch — which is the property the Pen Board depends
 * on: someone moves an animal from the house, and the kiosk in the barn
 * redraws without anybody touching it.
 */

export interface RecordsState<T> {
  readonly records: readonly T[];
  /** True until the first result arrives. Not the same as "empty". */
  readonly loading: boolean;
}

export function useRecords<T extends BaseRecord>(
  store: LocalStoreName,
  query: Omit<ListQuery, "propertyId"> & { readonly propertyId: Ulid },
): RecordsState<T> {
  const { store: local } = useSync();
  const [records, setRecords] = useState<readonly T[]>([]);
  const [loading, setLoading] = useState(true);

  // Serialised so an object literal passed inline does not re-subscribe on
  // every render — which would tear down and rebuild the liveQuery each time.
  const key = JSON.stringify(query);

  useEffect(() => {
    if (local === undefined) return;

    const unsubscribe = local.repository<T>(store).observe(JSON.parse(key) as ListQuery, (next) => {
      setRecords(next);
      setLoading(false);
    });

    return unsubscribe;
  }, [local, store, key]);

  return { records, loading };
}

export function useRecord<T extends BaseRecord>(
  store: LocalStoreName,
  id: Ulid | undefined,
): { readonly record: T | undefined; readonly loading: boolean } {
  const { store: local } = useSync();
  const [record, setRecord] = useState<T | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (local === undefined || id === undefined) return;

    const unsubscribe = local.repository<T>(store).observeById(id, (next) => {
      setRecord(next);
      setLoading(false);
    });

    return unsubscribe;
  }, [local, store, id]);

  return { record, loading };
}
