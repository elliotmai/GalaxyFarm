/**
 * Getting an installed app off a stale build (spec §3, §4.2).
 *
 * A service worker is a small deployment system living on somebody's device,
 * and its default behaviour has two failure modes that sit on opposite sides
 * of the same switch. Take over immediately, and the page that is open loses
 * the chunks it was about to ask for. Wait politely for every tab to close,
 * and a screen screwed to a barn wall — which nobody reloads, ever, because
 * reloading it is a trip across a yard — keeps running last winter's build
 * until somebody unplugs it.
 *
 * So the worker waits (`app/sw.ts` sets `skipWaiting: false`) and this decides
 * when the wait ends. Two answers, because two kinds of screen:
 *
 *   - **A screen somebody is holding** is offered the update and takes it when
 *     they tap. They may be halfway through a form; a reload they did not ask
 *     for costs them what they typed.
 *   - **A screen nobody is holding** takes it by itself, once it has sat
 *     untouched long enough to be sure it is not interrupting a chore. That is
 *     the kiosk, and it is the case issue #11 names outright.
 *
 * Nothing here reloads anything on its own. Applying an update means asking the
 * waiting worker to take over; the page reloads when it does, which is what
 * keeps the document and the assets it holds on the same build.
 *
 * **This is the code path, not the data path.** A kiosk board already redraws
 * when the sync engine pulls new records, and it does that without a reload
 * because the data is in IndexedDB and the live query is watching. Nothing
 * here fires for a new *record*. It fires only when the app's own JavaScript
 * has changed, which is the one thing a live query cannot pick up.
 */

import { SKIP_WAITING } from "@/lib/sw-contract";

/**
 * How often a screen asks whether there is a newer build.
 *
 * The browser checks for itself on navigation, which covers a phone perfectly
 * well and covers a kiosk not at all: a board that is opened once and left up
 * navigates approximately never. Fifteen minutes puts a bound on how long a
 * fix takes to reach the barn without polling hard enough to matter — it is
 * one conditional request for a file of a few tens of kilobytes.
 */
export const UPDATE_POLL_MS = 15 * 60_000;

/**
 * How long an unattended screen must sit untouched before it updates itself.
 *
 * Long enough that it is not going to reload under a gloved hand halfway
 * through logging eggs, short enough that the update lands the same morning.
 * Only human input counts as touching it — a sync tick or an animation is the
 * app being alive, not somebody using it.
 */
export const IDLE_BEFORE_APPLY_MS = 60_000;

/** The events that mean a person is at the screen. */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/**
 * What this needs from a `ServiceWorker`.
 *
 * Structural rather than the DOM type so the tests can drive it with a plain
 * object. A real `ServiceWorker` satisfies it; nothing here is a re-declaration
 * of the platform.
 */
export interface UpdatableWorker {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}

/** Likewise, the part of a `ServiceWorkerRegistration` that matters here. */
export interface UpdatableRegistration {
  readonly installing: UpdatableWorker | null;
  readonly waiting: UpdatableWorker | null;
  update(): Promise<unknown>;
  addEventListener(type: "updatefound", listener: () => void): void;
  removeEventListener(type: "updatefound", listener: () => void): void;
}

export interface UpdateWatchOptions {
  readonly registration: UpdatableRegistration;
  /** Called once a newer build has installed and is waiting to take over. */
  readonly onUpdateReady: () => void;
  /**
   * Whether this page is already under a worker's control.
   *
   * The distinction this draws is the whole reason it exists: a worker that
   * reaches `installed` with nothing controlling the page is the *first* one
   * this device has ever had, not a new build replacing an old one. Announcing
   * that as an update offers somebody a reload on their first ever visit, and
   * on an unattended screen it would reload a page that had only just opened.
   */
  readonly isControlled?: () => boolean;
  readonly pollMs?: number;
}

function pageIsControlled(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    navigator.serviceWorker.controller !== null
  );
}

/**
 * Watch a registration for a build that has installed and is waiting.
 *
 * Three ways in, because none of them is reliable on its own: the browser's own
 * `updatefound`, a poll for the screens that never navigate, and a check on the
 * spot for the build that installed while the tab was closed and was already
 * waiting when this ran. Returns a teardown.
 */
export function watchForUpdates({
  registration,
  onUpdateReady,
  isControlled = pageIsControlled,
  pollMs = UPDATE_POLL_MS,
}: UpdateWatchOptions): () => void {
  const teardown: Array<() => void> = [];
  let announced = false;

  const announce = (worker: UpdatableWorker | null): void => {
    if (announced || worker === null) return;
    if (worker.state !== "installed") return;
    if (!isControlled()) return;
    announced = true;
    onUpdateReady();
  };

  const watchInstalling = (): void => {
    const worker = registration.installing;
    if (worker === null) return;
    const onStateChange = (): void => announce(worker);
    worker.addEventListener("statechange", onStateChange);
    teardown.push(() => worker.removeEventListener("statechange", onStateChange));
    // Already there by the time we looked: `updatefound` and `installed` can
    // land in the same task.
    announce(worker);
  };

  registration.addEventListener("updatefound", watchInstalling);
  teardown.push(() => registration.removeEventListener("updatefound", watchInstalling));

  const check = (): void => {
    // A poll with no signal is a non-event, not a fault: the screen is offline,
    // which is the state this whole file exists to make survivable.
    void registration.update().catch(() => undefined);
  };

  const timer = setInterval(check, pollMs);
  teardown.push(() => clearInterval(timer));

  if (typeof window !== "undefined") {
    // Coming back into signal is the likeliest moment for a build to be waiting
    // on the other end, and a barn screen may have been out of it for hours.
    window.addEventListener("online", check);
    teardown.push(() => window.removeEventListener("online", check));
  }

  announce(registration.waiting);

  return () => {
    for (const undo of teardown) undo();
  };
}

/**
 * Ask the waiting worker to take over.
 *
 * Answers whether there was one, which is not a formality: a page can be told
 * an update is ready and then have it activate on its own — another tab of the
 * same app applying it, say — leaving nothing to talk to here.
 */
export function applyUpdate(registration: UpdatableRegistration): boolean {
  const waiting = registration.waiting;
  if (waiting === null) return false;
  waiting.postMessage({ type: SKIP_WAITING });
  return true;
}

/** The slice of `window` and `document` that `applyWhenIdle` listens on. */
export interface ActivityTarget {
  addEventListener(type: string, listener: () => void, options?: { passive?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface ApplyWhenIdleOptions {
  readonly idleMs?: number;
  readonly target?: ActivityTarget | undefined;
}

/**
 * Run `apply` once the screen has gone quiet, and put it off every time
 * somebody touches it.
 *
 * The waiting worker does not expire, so putting it off costs nothing — an
 * update deferred through a whole morning of chores lands at lunchtime instead.
 * What it buys is that a screen never reloads under the hand that is using it.
 *
 * Returns a teardown that also cancels the pending apply.
 */
export function applyWhenIdle(
  apply: () => void,
  { idleMs = IDLE_BEFORE_APPLY_MS, target = globalThisDocument() }: ApplyWhenIdleOptions = {},
): () => void {
  let timer = setTimeout(apply, idleMs);

  const defer = (): void => {
    clearTimeout(timer);
    timer = setTimeout(apply, idleMs);
  };

  for (const event of ACTIVITY_EVENTS) {
    target?.addEventListener(event, defer, { passive: true });
  }

  return () => {
    clearTimeout(timer);
    for (const event of ACTIVITY_EVENTS) {
      target?.removeEventListener(event, defer);
    }
  };
}

function globalThisDocument(): ActivityTarget | undefined {
  return typeof document === "undefined" ? undefined : document;
}

/**
 * Whether a `controllerchange` means this page should reload.
 *
 * Both halves catch a real reload loop. A page that was *not* controlled has
 * just been claimed by its first worker, and reloading on that would reload
 * every first visit the app ever gets. And `controllerchange` can fire more
 * than once — two tabs applying the same update — so a reload already under way
 * must not start another.
 */
export function shouldReloadOnControllerChange(
  wasControlled: boolean,
  alreadyReloading: boolean,
): boolean {
  return wasControlled && !alreadyReloading;
}
