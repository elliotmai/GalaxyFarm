"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { loadCursors, saveCursors } from "@/lib/local/cursors";
import { localStore, type LocalStore } from "@/lib/local/store";

/**
 * Runs the sync loop for the tab (spec §4.2).
 *
 * Nothing on screen waits on it. The local store is the only thing the UI
 * reads, and this pushes and pulls behind that — so a page renders at the same
 * speed with no signal as with five bars, and Neon's cold start never lands in
 * front of someone standing in a pen.
 */

const EVERY = 60_000;

export interface SyncState {
  readonly store: LocalStore | undefined;
  /** Set while a push or pull is in flight. */
  readonly syncing: boolean;
  /** True when the last attempt could not reach the server. */
  readonly offline: boolean;
  /**
   * Set when the server answered and refused.
   *
   * Kept apart from `offline` because the two mean opposite things to somebody
   * holding a phone: no signal in a pasture is normal, and a 500 is a fault
   * that will still be there tomorrow.
   */
  readonly problem: string | undefined;
  readonly lastSyncedAt: Date | undefined;
  /** Local edits not yet accepted by the server. */
  readonly pending: number;
  /**
   * Edits the server rejected often enough to be set aside.
   *
   * Counted apart from `pending` because they mean something different: these
   * will not go on their own, and a badge that folds them into one number is a
   * badge that says "12 to send" for a fortnight.
   */
  readonly stuck: number;
  syncNow(): Promise<void>;
  /** Put the set-aside entries back in the queue. */
  retryStuck(): Promise<void>;
}

const SyncContext = createContext<SyncState | undefined>(undefined);

export function useSync(): SyncState {
  const state = useContext(SyncContext);
  if (state === undefined) throw new Error("useSync must be used inside a <SyncProvider>");
  return state;
}

export function SyncProvider({ children }: { readonly children: ReactNode }) {
  // Built in an effect, not at module scope: IndexedDB does not exist during
  // the server render, and touching it there is a crash rather than a warning.
  const [store, setStore] = useState<LocalStore | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | undefined>();
  const [pending, setPending] = useState(0);
  const [stuck, setStuck] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    const built = localStore();
    built.engine.restoreCursors(loadCursors());
    setStore(built);
  }, []);

  const syncNow = useCallback(async () => {
    if (store === undefined) return;
    // One sync at a time. Two overlapping runs would drain the same outbox
    // entries twice and push each of them to the server twice.
    if (running.current) return;

    running.current = true;
    setSyncing(true);
    try {
      const outcome = await store.engine.sync();
      setOffline(outcome.offline);
      setProblem(outcome.problem);
      if (!outcome.offline && outcome.problem === undefined) {
        setLastSyncedAt(new Date());
        saveCursors(store.engine.cursorState());
      }
      setPending(await store.engine.pendingCount());
      setStuck(await store.engine.stuckCount());
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [store]);

  const retryStuck = useCallback(async () => {
    if (store === undefined) return;
    await store.engine.retryStuck();
    await syncNow();
  }, [store, syncNow]);

  useEffect(() => {
    if (store === undefined) return;

    void syncNow();
    const timer = setInterval(() => void syncNow(), EVERY);

    // Coming back into signal is the moment that matters most — somebody has
    // just driven out of the pasture with a morning's work queued.
    const onOnline = () => void syncNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store, syncNow]);

  const value = useMemo<SyncState>(
    () => ({ store, syncing, offline, problem, lastSyncedAt, pending, stuck, syncNow, retryStuck }),
    [store, syncing, offline, problem, lastSyncedAt, pending, stuck, syncNow, retryStuck],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
