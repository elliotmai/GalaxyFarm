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
import { photoUploader } from "@/lib/photos/uploader";

/**
 * Runs the sync loop for the tab (spec §4.2).
 *
 * Nothing on screen waits on it. The local store is the only thing the UI
 * reads, and this pushes and pulls behind that — so a page renders at the same
 * speed with no signal as with five bars, and Neon's cold start never lands in
 * front of someone standing in a pen.
 *
 * Photo bytes drain on the same heartbeat, which is the whole of "a photo
 * taken in the barn with no signal uploads later, with the user doing
 * nothing": there is no upload button anywhere in this app, and there is not
 * meant to be. The counts below fold the photo queue in with the outbox, so
 * the badge says what is actually still on the device rather than only the
 * part of it that is text.
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
  /**
   * Local work not yet accepted by the server — edits and photographs alike.
   *
   * One number rather than two, because the question somebody is asking when
   * they look at it is "can I close the app yet", and "3 to send" beside a
   * separate "and 2 photos" answers it twice.
   */
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

/** The half of `SyncState` that changes as the engine runs. */
export type SyncStatus = Omit<SyncState, "store" | "syncNow" | "retryStuck">;

/** The half that does not: the store, and the two ways to prod the engine. */
export type SyncEngineHandle = Pick<SyncState, "store" | "syncNow" | "retryStuck">;

/**
 * Two contexts rather than one, and the split is the point.
 *
 * Everything in this app reads its data through `useRecords`, which needs the
 * store — and the store is settled within a render of the surface mounting and
 * never changes again. The status beside it changes constantly: `syncing` goes
 * true and false on every heartbeat, `pending` counts down as the outbox
 * drains, `lastSyncedAt` moves every minute.
 *
 * Held together, as they were, those two facts share a context value, and a new
 * value re-renders every consumer. So the minute hand on the sync badge was
 * re-rendering every screen in the app, sixty seconds apart, for a number none
 * of them display — which also quietly undid the sharing in `live-records.ts`,
 * since a component that re-renders anyway does not care that its rows did not
 * change.
 *
 * Apart, the badge re-renders on the heartbeat and nothing else does.
 */
const EngineContext = createContext<SyncEngineHandle | undefined>(undefined);
const StatusContext = createContext<SyncStatus | undefined>(undefined);

/**
 * The store and the controls — everything that does not change per heartbeat.
 *
 * What a screen wants. Reading records, writing them, and pull-to-refresh all
 * go through this rather than through `useSync`, so none of them is woken by a
 * sync tick.
 */
export function useSyncEngine(): SyncEngineHandle {
  const handle = useContext(EngineContext);
  if (handle === undefined) throw new Error("useSyncEngine must be used inside a <SyncProvider>");
  return handle;
}

/** How the engine is getting on. Only the badge wants this. */
export function useSyncStatus(): SyncStatus {
  const status = useContext(StatusContext);
  if (status === undefined) throw new Error("useSyncStatus must be used inside a <SyncProvider>");
  return status;
}

/**
 * Both halves.
 *
 * Subscribes to the status, so anything using it re-renders on every
 * heartbeat. That is right for the sync badge, which is the thing the status is
 * for, and wrong for a screen — use `useSyncEngine` there.
 */
export function useSync(): SyncState {
  return { ...useSyncStatus(), ...useSyncEngine() };
}

export function SyncProvider({
  children,
  pushEnabled = true,
}: {
  readonly children: ReactNode;
  /**
   * Off for a kiosk (spec §4.3, §4.4). `/api/sync/push` refuses anything that
   * is not `owner` or `member` outright, so a kiosk's outbox — always empty,
   * since its writes go through dedicated server actions rather than
   * `useMutations` — would still 403 on every attempt and light up the sync
   * badge as broken. Pulling stays on: reads are the whole reason a barn
   * screen keeps a local store at all.
   */
  readonly pushEnabled?: boolean;
}) {
  /*
   * Built on the first client render, not at module scope and not in an effect.
   *
   * Not module scope, because IndexedDB does not exist during the server
   * render and touching it there is a crash rather than a warning — hence the
   * guard, which is what "are we on a device" looks like here.
   *
   * Not an effect either, though, which is where it used to be. An effect
   * cannot run until after the first paint, so every screen under this
   * provider rendered once with no store to read from, painted a skeleton, and
   * only then started opening the database. Doing it in the initialiser starts
   * the connection during the render that mounts the surface, so the read is
   * already in flight — often already answered, from `live-records`' cache —
   * by the time a screen asks. `localStore` is idempotent, so React calling
   * this twice under Strict Mode builds one store.
   */
  const [store] = useState<LocalStore | undefined>(() =>
    typeof indexedDB === "undefined" ? undefined : localStore(),
  );
  /*
   * One uploader per provider, built beside the store for the same reason.
   *
   * It holds the backoff clock for the photo queue, so a second one would let
   * two drains run against the same entries and upload the same bytes twice.
   */
  const [uploads] = useState(() => (store === undefined ? undefined : photoUploader(store)));
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | undefined>();
  const [pending, setPending] = useState(0);
  const [stuck, setStuck] = useState(0);
  const running = useRef(false);

  // Cursors are a `localStorage` read, so they wait for the client the same way
  // the store does — but only the sync loop below needs them, and that starts
  // in an effect regardless.
  useEffect(() => {
    if (store === undefined) return;
    store.engine.restoreCursors(loadCursors());
  }, [store]);

  const syncNow = useCallback(async () => {
    if (store === undefined) return;
    // One sync at a time. Two overlapping runs would drain the same outbox
    // entries twice and push each of them to the server twice.
    if (running.current) return;

    running.current = true;
    setSyncing(true);
    try {
      const outcome = pushEnabled
        ? await store.engine.sync()
        : { pushed: 0, rejected: 0, audit: [], ...(await store.engine.pull()) };

      // Photos go after the records, and only where pushing is allowed at all.
      // A kiosk's outbox is empty by design (§4.4) and `/api/storage/presign`
      // refuses it, so draining there would light the badge up as broken over
      // a queue that is always empty.
      const photos =
        pushEnabled && uploads !== undefined
          ? await uploads.drain()
          : { uploaded: 0, refused: 0, offline: false, problem: undefined };

      setOffline(outcome.offline || photos.offline);
      setProblem(outcome.problem ?? photos.problem);
      if (!outcome.offline && outcome.problem === undefined) {
        setLastSyncedAt(new Date());
        saveCursors(store.engine.cursorState());
      }
      setPending((await store.engine.pendingCount()) + ((await uploads?.pendingCount()) ?? 0));
      setStuck((await store.engine.stuckCount()) + ((await uploads?.stuckCount()) ?? 0));
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [store, pushEnabled, uploads]);

  const retryStuck = useCallback(async () => {
    if (store === undefined) return;
    await store.engine.retryStuck();
    await uploads?.retryStuck();
    await syncNow();
  }, [store, syncNow, uploads]);

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

  const engine = useMemo<SyncEngineHandle>(
    () => ({ store, syncNow, retryStuck }),
    [store, syncNow, retryStuck],
  );

  const status = useMemo<SyncStatus>(
    () => ({ syncing, offline, problem, lastSyncedAt, pending, stuck }),
    [syncing, offline, problem, lastSyncedAt, pending, stuck],
  );

  return (
    <EngineContext.Provider value={engine}>
      <StatusContext.Provider value={status}>{children}</StatusContext.Provider>
    </EngineContext.Provider>
  );
}
