/**
 * Offering to install the app (spec §3).
 *
 * An installed PWA is not a nicety here, it is the point: the whole of §4.2 —
 * a store on the device, a queue that survives being killed, a screen that
 * draws with no signal — is reached through whatever the person tapped, and a
 * browser tab is the one entry point that can be closed by accident and does
 * not open full screen on a barn tablet.
 *
 * Chromium offers `beforeinstallprompt`, which lets the page hold the browser's
 * own install prompt and raise it at a better moment than the browser would
 * have. Nothing else implements it — on iOS, installing is Share → Add to Home
 * Screen and no page can ask for it — so this is an enhancement where it
 * exists and silence where it does not, never a banner explaining what the
 * user should have done instead.
 *
 * The rules below are all about not nagging. An install prompt that reappears
 * on every page load is a thing people learn to dismiss without reading, which
 * costs the install it was asking for.
 */

/** Where a dismissal is remembered. Namespaced, because `localStorage` is one drawer. */
export const INSTALL_DISMISSED_KEY = "gf.install-prompt.dismissed-at";

/**
 * How long "not now" lasts.
 *
 * A month, so somebody who declined in March is asked again in April rather
 * than never — the answer to "do you want this on your home screen" changes
 * once the app has become part of the day — and rather than tomorrow, which is
 * how a prompt turns into noise.
 */
export const DISMISSAL_HOLDS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The part of `Storage` this uses.
 *
 * Narrow on purpose: it makes the tests a three-line object, and it makes the
 * one thing that can go wrong — a browser that throws on `localStorage` rather
 * than returning null, which Safari does with cookies blocked — obvious at the
 * two places it is touched.
 */
export interface DismissalStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * `beforeinstallprompt`, which is not in the DOM lib because it is not in any
 * standard. Declared as what Chromium actually fires.
 */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: InstallPromptEvent;
  }
}

/**
 * When the prompt was last declined, if it was.
 *
 * Anything unreadable — absent, not a number, a storage that refuses to answer
 * — reads as "never declined". The cost of getting this wrong in that
 * direction is one prompt too many; in the other it is an app that can never be
 * installed because of a stray value nobody can see.
 */
export function readDismissal(store: DismissalStore | undefined): Date | undefined {
  if (store === undefined) return undefined;
  let raw: string | null;
  try {
    raw = store.getItem(INSTALL_DISMISSED_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  const at = Number(raw);
  if (!Number.isFinite(at) || at <= 0) return undefined;
  return new Date(at);
}

/** Remember a "not now". A storage that refuses is not worth failing a page over. */
export function recordDismissal(store: DismissalStore | undefined, now: Date): void {
  if (store === undefined) return;
  try {
    store.setItem(INSTALL_DISMISSED_KEY, String(now.getTime()));
  } catch {
    // Private browsing, quota, a locked-down kiosk profile. The prompt comes
    // back next visit, which is worse than remembering and better than a crash.
  }
}

/** Whether enough time has passed since the last "not now" to ask again. */
export function installOfferIsDue(dismissedAt: Date | undefined, now: Date): boolean {
  if (dismissedAt === undefined) return true;
  return now.getTime() - dismissedAt.getTime() >= DISMISSAL_HOLDS_MS;
}

/**
 * Whether the app is already running as an installed app.
 *
 * Chromium withholds `beforeinstallprompt` from an installed app, so on that
 * side this is belt and braces. On iOS it is the only signal there is: the
 * event never fires at all, and a home-screen launch identifies itself through
 * `navigator.standalone`, which is Safari's and in no standard — hence the
 * cast, which is the honest way to write "this may not be here".
 */
export function isRunningInstalled(view: Window | undefined): boolean {
  if (view === undefined) return false;
  if (view.matchMedia?.("(display-mode: standalone)").matches === true) return true;
  return (view.navigator as { standalone?: boolean }).standalone === true;
}
