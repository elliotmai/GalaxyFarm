"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@galaxy-farm/ui";

import {
  installOfferIsDue,
  isRunningInstalled,
  readDismissal,
  recordDismissal,
  type InstallPromptEvent,
} from "@/lib/install-prompt";
import {
  applyUpdate,
  applyWhenIdle,
  shouldReloadOnControllerChange,
  watchForUpdates,
} from "@/lib/sw-update";

/**
 * The installed app's own chrome (spec §3, §4.2).
 *
 * Registers the service worker, offers to install the app where the browser
 * allows it, and decides when a new build takes over. It renders nothing at all
 * most of the time, which is the intended state: this is the part of the app
 * that only speaks up when there is something to say.
 *
 * Mounted by each surface layout rather than by the root, and that is
 * deliberate. Everything visible here has to sit inside a `[data-theme]` to
 * have any colours at all — the tokens are declared on the surface element, not
 * on `:root` (see `globals.css`) — and inside a `[data-density]` to be the
 * right size for the screen it is on. A bar mounted at the root would be
 * transparent text at laptop scale on a barn kiosk. `route-map.test.ts` checks
 * every surface mounts it, so a new surface cannot quietly ship without one.
 */

/**
 * Everywhere except development, where there is no worker to register:
 * `next.config.ts` disables Serwist there, `/sw.js` does not exist, and a
 * worker caching a build that changes on every keystroke would be its own kind
 * of ghost. Written as "not development" rather than "production" so the test
 * environment is on the same side of the line as the browser — a component
 * whose whole behaviour is switched off under test is one nothing can check.
 */
const ENABLED = process.env.NODE_ENV !== "development";

export interface PwaShellProps {
  /**
   * True for a screen nobody is holding — a kiosk on a barn wall.
   *
   * Such a screen applies a new build by itself once it has sat untouched for a
   * minute, because the alternative is that it never applies one: nobody walks
   * out to the barn to reload a wall-mounted tablet. Every other surface is
   * offered the update and takes it on a tap, because the person in front of it
   * may be halfway through typing something.
   */
  readonly unattended?: boolean;
  /**
   * Whether to offer installing the app.
   *
   * Off for the public pages. Somebody reading about the farm for the first
   * time is deciding whether to send a calf here, not whether to put a herd
   * management app on their phone, and being asked is the web at its most
   * tiresome.
   */
  readonly offerInstall?: boolean;
}

export function PwaShell({ unattended = false, offerInstall = true }: PwaShellProps) {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!ENABLED || !("serviceWorker" in navigator)) return;

    /**
     * Whether this page was already under a worker before we started.
     *
     * Read now, because it is about to change: the first worker claims the page
     * moments after it activates, and by the time `controllerchange` fires the
     * question "was there one before?" can no longer be asked.
     */
    const wasControlled = navigator.serviceWorker.controller !== null;
    let reloading = false;
    let stopWatching: (() => void) | undefined;
    let cancelled = false;

    /**
     * The new build has taken over. Reload, so the document and the assets it
     * is about to ask for come from the same build — which is the entire reason
     * the worker waited rather than skipping.
     */
    const onControllerChange = (): void => {
      if (!shouldReloadOnControllerChange(wasControlled, reloading)) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker
      // `updateViaCache: "none"` so the check for a new build is never answered
      // out of the HTTP cache. A screen that asks every fifteen minutes and is
      // told each time what it was told this morning has not checked at all.
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registered) => {
        if (cancelled) return;
        registration.current = registered;
        stopWatching = watchForUpdates({
          registration: registered,
          onUpdateReady: () => setUpdateReady(true),
        });
      })
      .catch((error: unknown) => {
        // Worth saying out loud: silently having no worker is exactly the state
        // that looks fine until the day the network is down.
        console.warn("Service worker registration failed", error);
      });

    return () => {
      cancelled = true;
      stopWatching?.();
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const apply = useCallback(() => {
    const registered = registration.current;
    if (registered !== undefined) applyUpdate(registered);
  }, []);

  useEffect(() => {
    if (!updateReady || !unattended) return;
    return applyWhenIdle(apply);
  }, [updateReady, unattended, apply]);

  return (
    <>
      {updateReady && !unattended ? <UpdateBar onReload={apply} /> : null}
      {offerInstall ? <InstallBar /> : null}
    </>
  );
}

/** Where both bars sit: out of the way, above a safe-area inset, over the page. */
const BAR =
  "fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-2xl flex-wrap " +
  "items-center justify-between gap-density rounded-density border border-edge " +
  "bg-panel p-density text-ink shadow-lg";

function UpdateBar({ onReload }: { readonly onReload: () => void }) {
  return (
    <div role="status" className={BAR}>
      <p className="text-sm">
        A newer version of the app is ready.
        <span className="block text-muted">
          Nothing you have logged is affected — it is on this device already.
        </span>
      </p>
      <Button variant="primary" onClick={onReload}>
        Reload
      </Button>
    </div>
  );
}

/**
 * The install offer.
 *
 * Nothing is rendered until the browser says an install is possible, so on iOS
 * and on an already-installed app this is a component that never draws.
 */
function InstallBar() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | undefined>();

  useEffect(() => {
    if (isRunningInstalled(window)) return;
    if (!installOfferIsDue(readDismissal(window.localStorage), new Date())) return;

    const onPromptable = (event: InstallPromptEvent): void => {
      // Holding the browser's own prompt rather than letting it fire is the
      // whole point of the event: it is raised on a tap below instead of over
      // whatever the person was reading.
      event.preventDefault();
      setPrompt(event);
    };
    const onInstalled = (): void => setPrompt(undefined);

    window.addEventListener("beforeinstallprompt", onPromptable);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPromptable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (prompt === undefined) return null;

  return (
    <div role="status" className={BAR}>
      <p className="text-sm">
        Install the app
        <span className="block text-muted">
          Opens full screen, and keeps working when the signal does not.
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          onClick={() => {
            recordDismissal(window.localStorage, new Date());
            setPrompt(undefined);
          }}
        >
          Not now
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            // The outcome is the browser's to report and the user's to choose;
            // either way this prompt has been used and cannot be raised again.
            void prompt.prompt();
            setPrompt(undefined);
          }}
        >
          Install
        </Button>
      </div>
    </div>
  );
}
