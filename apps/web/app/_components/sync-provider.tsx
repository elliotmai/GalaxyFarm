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
import { nextSyncDelay } from "@/lib/sync-schedule";

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
  quietOvernight = false,
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
  /**
   * On for the kiosk surface: an unattended screen drops to a heartbeat every
   * 30 minutes overnight (`lib/sync-schedule.ts`). A person's phone does not —
   * somebody up at 2 a.m. with a calving is exactly who wants it current.
   */
  readonly quietOvernight?: boolean;
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
  /** A sync was asked for while one was running; go round once more. */
  const again = useRef(false);
  /** Server refusals in a row, for the heartbeat's backoff. */
  const refusals = useRef(0);

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
    //
    // But a write that arrives while a run is in flight is remembered, and the
    // run goes round once more for it. Without that, anything queued after the
    // push had read the outbox — the tail of a machine deleted with its
    // ledgers, the second of two quick saves — sat "pending" until the next
    // heartbeat, a minute later, which reads as a save that will not finish.
    if (running.current) {
      again.current = true;
      return;
    }

    running.current = true;
    setSyncing(true);
    try {
      let settled = true;
      do {
        again.current = false;
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
        // Only a refusal counts. Offline is not the server's fault, and coming
        // back into signal fires a sync of its own.
        if (outcome.problem !== undefined) refusals.current += 1;
        else if (!outcome.offline) refusals.current = 0;
        if (!outcome.offline && outcome.problem === undefined) {
          setLastSyncedAt(new Date());
          saveCursors(store.engine.cursorState());
        }
        setPending((await store.engine.pendingCount()) + ((await uploads?.pendingCount()) ?? 0));
        setStuck((await store.engine.stuckCount()) + ((await uploads?.stuckCount()) ?? 0));
        // Offline or refused: going round again now would only fail again.
        // The heartbeat's backoff owns the retry from here.
        settled = !outcome.offline && outcome.problem === undefined;
      } while (again.current && settled);
    } finally {
      running.current = false;
      again.current = false;
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

    // A chain of timeouts rather than an interval, so each wait can be chosen
    // after the last heartbeat: longer overnight on a kiosk, longer while the
    // server keeps refusing (`lib/sync-schedule.ts`).
    let timer: ReturnType<typeof setTimeout>;
    // A heartbeat still in flight at unmount must not schedule another.
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      const delay = nextSyncDelay({
        at: new Date(),
        quietOvernight,
        refusals: refusals.current,
      });
      timer = setTimeout(() => {
        // A hidden tab skips its heartbeat — nobody is looking, and the
        // visibility listener below syncs the moment somebody is.
        const tick = document.visibilityState === "hidden" ? Promise.resolve() : syncNow();
        void tick.finally(schedule);
      }, delay);
    };
    schedule();

    // Coming back into signal is the moment that matters most — somebody has
    // just driven out of the pasture with a morning's work queued.
    const onOnline = () => void syncNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store, syncNow, quietOvernight]);

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
