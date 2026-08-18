"use client";

import type { BaseRecord, ListQuery, Ulid } from "@galaxy-farm/core";

import type { LocalStore, LocalStoreName } from "@/lib/local/store";

/**
 * One live query per question, not one per component (spec §4.2).
 *
 * `useRecords` used to open a Dexie `liveQuery` per call site. That is one
 * subscription — and one full read of the table, filtered and sorted — for
 * every component that asks, every time the table changes. The dashboard alone
 * asks the same questions three times over: the tiles, the calving watch and
 * the weaning card all want `animals`, and all three re-read the herd end to
 * end whenever a sync pull writes a single row.
 *
 * So the subscriptions live here instead, keyed by the question rather than by
 * the asker. Three components wanting the same rows share one read and one
 * result, and a fourth arriving later gets the answer that is already in hand.
 *
 * Two consequences worth naming, because they are the point rather than a side
 * effect:
 *
 * **A screen you have already opened redraws instantly.** The rows outlive the
 * components that were looking at them, so coming back to the herd — from an
 * animal, from a tab strip, from the back button — paints the herd, not a
 * skeleton of one. The live query re-runs behind that and corrects it within a
 * frame if anything moved.
 *
 * **A sync pull no longer re-renders the app.** A pull writes to most tables on
 * most runs, and Dexie re-runs every query over a table it touched — but
 * "re-ran" is not "changed". Results are compared before anyone is told, so the
 * sixty-second heartbeat stops costing a render of every mounted screen.
 */

export interface RecordsState<T> {
  readonly records: readonly T[];
  /** True until the first result arrives. Not the same as "empty". */
  readonly loading: boolean;
}

export interface RecordState<T> {
  readonly record: T | undefined;
  readonly loading: boolean;
}

/**
 * How long a query stays live after the last component looking at it leaves.
 *
 * One sync interval. Long enough that stepping into an animal and back, or
 * moving along a tab strip, finds the subscription still running and the rows
 * already correct; short enough that a screen nobody has open is not being
 * re-read every time the engine pulls.
 */
export const IDLE_MS = 60_000;

/**
 * How many answers to keep once their subscription has been torn down.
 *
 * Rows are kept past the subscription so a return visit has something to draw
 * immediately. Nearly every query in the app is `{ propertyId }` against one of
 * fifty stores, so the natural population is small — but the herd search box
 * makes a fresh query per keystroke, and without a bound those would accumulate
 * for as long as the tab is open.
 */
const WARM_LIMIT = 64;

/**
 * The answer before there is one, as two frozen singletons.
 *
 * Exported because `useSyncExternalStore` compares snapshots by reference and
 * asks for one more than once per render: a fresh literal here, or a second
 * copy of it in the hook, would be a render loop or a needless re-render on
 * every hydration.
 */
const EMPTY: readonly BaseRecord[] = [];
export const NO_RECORDS: RecordsState<BaseRecord> = { records: EMPTY, loading: true };
export const NO_RECORD: RecordState<BaseRecord> = { record: undefined, loading: true };

interface Entry<S> {
  /** Handed to React as-is. Replaced only when the answer actually differs. */
  snapshot: S;
  readonly listeners: Set<() => void>;
  /** Tears down the underlying Dexie subscription; unset when not live. */
  stop: (() => void) | undefined;
  /** Pending idle teardown, cancelled if somebody subscribes again first. */
  idle: ReturnType<typeof setTimeout> | undefined;
}

/** Insertion-ordered, which is what makes the eviction below oldest-first. */
const lists = new Map<string, Entry<RecordsState<BaseRecord>>>();
const singles = new Map<string, Entry<RecordState<BaseRecord>>>();

/** A key that is also the query it stands for — see `queryKey`. */
interface KeyedQuery extends ListQuery {
  readonly store: LocalStoreName;
}

/**
 * The query, as a string, in a fixed field order.
 *
 * Canonical rather than a plain `JSON.stringify` of whatever the caller passed,
 * so two call sites that spell the same question differently share one
 * subscription instead of opening two. `{ propertyId }` and
 * `{ propertyId, includeDeleted: false }` are the same question — the
 * repository cannot tell them apart — and a key that separated them would put
 * two live queries on one table and answer both with identical rows.
 *
 * It doubles as the query itself, parsed back when the subscription opens.
 * That is what lets a component hand React a subscribe callback depending on
 * one string and nothing else: a query written as an object literal inside a
 * screen is a new object on every render, and a subscription keyed on it would
 * be torn down and rebuilt every time anything on the page changed.
 */
export function queryKey(store: LocalStoreName, query: ListQuery): string {
  const search = query.search?.trim() ?? "";
  const keyed: KeyedQuery = {
    store,
    propertyId: query.propertyId,
    ...(search === "" ? {} : { search }),
    ...((query.includeDeleted ?? false) ? { includeDeleted: true } : {}),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  };
  return JSON.stringify(keyed);
}

export function recordKey(store: LocalStoreName, id: Ulid): string {
  return `${store} ${id}`;
}

export function snapshotFor(key: string): RecordsState<BaseRecord> {
  return lists.get(key)?.snapshot ?? NO_RECORDS;
}

export function recordSnapshotFor(key: string): RecordState<BaseRecord> {
  return singles.get(key)?.snapshot ?? NO_RECORD;
}

/**
 * Watch a query, sharing the underlying read with everybody else asking it.
 *
 * Shaped for `useSyncExternalStore`: the callback takes no arguments and the
 * value is fetched separately with `snapshotFor`. That is what lets a component
 * mounting into a warm cache render the rows on its very first pass — no
 * effect, no second render, and no flash of an empty state on the way.
 */
export function subscribeRecords(local: LocalStore, key: string, onChange: () => void): () => void {
  const { store, ...query } = JSON.parse(key) as KeyedQuery;

  const entry = claim(lists, key, NO_RECORDS);
  entry.listeners.add(onChange);

  if (entry.stop === undefined) {
    entry.stop = local.repository<BaseRecord>(store).observe(query, (records) => {
      // A `liveQuery` re-runs whenever anything in its table changes, which
      // during a sync pull means once per batch whether or not this query's
      // rows are among the rows written. Telling React only when the answer
      // moved is what keeps the pull off the render path.
      if (!entry.snapshot.loading && same(entry.snapshot.records, records)) return;

      entry.snapshot = { records, loading: false };
      announce(entry);
    });
  }

  evict(lists);
  return () => release(entry, onChange);
}

export function subscribeRecord(
  local: LocalStore,
  store: LocalStoreName,
  id: Ulid,
  key: string,
  onChange: () => void,
): () => void {
  const entry = claim(singles, key, NO_RECORD);
  entry.listeners.add(onChange);

  if (entry.stop === undefined) {
    entry.stop = local.repository<BaseRecord>(store).observeById(id, (record) => {
      if (!entry.snapshot.loading && sameRecord(entry.snapshot.record, record)) return;

      entry.snapshot = { record, loading: false };
      announce(entry);
    });
  }

  evict(singles);
  return () => release(entry, onChange);
}

/**
 * Drop everything.
 *
 * Called by `resetLocalStore`, and for the same reason: rows cached out of a
 * database that no longer exists are worse than no cache at all. Tests and hot
 * reloads are the only callers.
 */
export function resetLiveRecords(): void {
  for (const map of [lists, singles]) {
    for (const entry of map.values()) {
      if (entry.idle !== undefined) clearTimeout(entry.idle);
      entry.stop?.();
    }
    // Empties a cache of rows, not the rows. Nothing here is persisted: the
    // records live in IndexedDB and are untouched by this, and the next read
    // puts them straight back.
    // crud-guard: allow-unconfirmed — a read-through cache, not stored data.
    map.clear();
  }
}

function claim<S>(map: Map<string, Entry<S>>, key: string, initial: S): Entry<S> {
  const entry: Entry<S> = map.get(key) ?? {
    snapshot: initial,
    listeners: new Set(),
    stop: undefined,
    idle: undefined,
  };

  if (entry.idle !== undefined) {
    clearTimeout(entry.idle);
    entry.idle = undefined;
  }

  // Deleted and re-set so the map's insertion order is least-recently-asked,
  // which is the order `evict` walks. The entry goes back on the next line.
  // crud-guard: allow-unconfirmed — reordering a Map key, not removing data.
  map.delete(key);
  map.set(key, entry);

  return entry;
}

function announce<S>(entry: Entry<S>): void {
  for (const listener of entry.listeners) listener();
}

function release<S>(entry: Entry<S>, onChange: () => void): void {
  // Taking a callback off a Set. Without it the query never goes idle — the
  // list it waits to empty never empties — and every screen ever opened keeps
  // re-reading its table for the life of the tab.
  // crud-guard: allow-unconfirmed — unsubscribing a listener, not deleting data.
  entry.listeners.delete(onChange);
  if (entry.listeners.size > 0) return;

  // Kept running for a moment rather than torn down on the spot. A navigation
  // unmounts the outgoing screen before it mounts the incoming one, and
  // neighbouring screens ask many of the same questions — dropping the
  // subscription in between would close it and reopen it on the same tick.
  entry.idle = setTimeout(() => {
    entry.idle = undefined;
    if (entry.listeners.size > 0) return;

    // Stop reading, but keep the answer: a return visit has something to draw.
    entry.stop?.();
    entry.stop = undefined;
  }, IDLE_MS);
}

function evict<S>(map: Map<string, Entry<S>>): void {
  if (map.size <= WARM_LIMIT) return;

  for (const [key, entry] of map) {
    if (map.size <= WARM_LIMIT) return;
    // Never evict something still being read. That would not save a read; it
    // would silently stop a screen updating.
    if (entry.listeners.size > 0 || entry.stop !== undefined) continue;
    // Forgets a cached answer nobody is reading. The records themselves are
    // in IndexedDB and are not touched; the whole cost of being wrong here is
    // that the next visit to that screen waits for a read rather than drawing
    // from memory.
    // crud-guard: allow-unconfirmed — evicting a cache entry, not a record.
    map.delete(key);
  }
}

/**
 * Whether two reads of the same query gave the same answer.
 *
 * `id` and `updatedAt` rather than a deep comparison. Every write in this app
 * goes through `useMutations` or a sync pull, and both stamp `updatedAt` — it
 * is the field the whole engine is built on, since cursors page by it and the
 * merge resolves by it. A record that changed without moving it would already
 * be a record that cannot sync.
 */
function same(left: readonly BaseRecord[], right: readonly BaseRecord[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (!sameRecord(left[index], right[index])) return false;
  }

  return true;
}

function sameRecord(left: BaseRecord | undefined, right: BaseRecord | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.id === right.id &&
    left.updatedAt.getTime() === right.updatedAt.getTime() &&
    // Not implied by `updatedAt` on its own, and the one transition a screen
    // must never miss: a row leaving or returning from Trash.
    left.deletedAt?.getTime() === right.deletedAt?.getTime()
  );
}
