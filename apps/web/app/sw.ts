/**
 * Serwist service worker entry point (spec §3, §4.2).
 *
 * The data layer has been offline-capable since the sync engine landed: every
 * screen reads IndexedDB through a live query, so a page already open redraws
 * with no signal at all. What the app could not do was *start*. With nothing
 * serving the document and the JavaScript that boots it, a barn screen power-
 * cycled while the wifi was down had nothing to open — a full local store sat
 * on the device, unreachable. That gap is the whole difference between "the
 * data works offline" and "the app works offline", and closing it is what this
 * file is for.
 *
 * Compiled by `@serwist/next` into `public/sw.js` (see `next.config.ts`), which
 * is why the precache manifest arrives as a global rather than an import: the
 * bundler substitutes `self.__SW_MANIFEST` with the list of every asset this
 * build emitted, each with its content hash.
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";

import { OFFLINE_ROUTE, mayCacheDocument, parsePushPayload } from "@/lib/sw-contract";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** A month. Long enough that a screen left in a barn over a bad-signal winter still boots. */
const APP_SHELL_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The app-shell cache's name, and why it carries a version.
 *
 * Bumping it makes every device drop what it is holding and start again. That
 * matters because of what `onlyPlainDocuments` below now refuses to store: a
 * screen that already has a sign-in page cached under a board's URL would keep
 * being handed it every time a navigation timed out, and a rule that only
 * governs future writes cannot reach a poisoned entry that is already there.
 * `maxAgeFrom: "last-used"` means it would never age out on its own either —
 * being served is what keeps it fresh.
 */
const APP_SHELL_CACHE = "app-shell-v2";

/**
 * What may be written to the app-shell cache: a page, and nothing else.
 *
 * The rule itself is `mayCacheDocument` in `lib/sw-contract.ts`, where it can
 * be tested without a worker, and where the reasoning lives. In short: a
 * sign-in or pairing redirect must never be stored under a board's own URL,
 * or a screen whose session is fine renders a sign-in page every time a
 * navigation falls back to the cache.
 *
 * Defining `cacheWillUpdate` at all replaces `NetworkFirst`'s default
 * (`cacheOkAndOpaquePlugin`, which allows both 200 and opaque status 0), which
 * is why the 200 is asserted there rather than assumed here.
 */
const onlyPlainDocuments = {
  cacheWillUpdate: async ({ response }: { response: Response }): Promise<Response | null> =>
    mayCacheDocument(response) ? response : null,
};

/**
 * Caching rules, matched in order — the first one that matches answers.
 *
 * These two sit in front of `defaultCache` because both of its equivalents are
 * wrong for this app rather than merely different.
 */
const runtimeCaching: RuntimeCaching[] = [
  {
    /**
     * Our own API is never answered from a cache.
     *
     * `defaultCache` puts a 24-hour NetworkFirst in front of `/api/*`, which is
     * a sensible default for an app that reads through its API. This one does
     * not read through its API at all — §4.2 has every screen reading the local
     * store — so the only `/api` traffic is sync, auth and presigning, and a
     * cached copy of any of the three is actively harmful. A replayed
     * `/api/sync/pull` would hand the engine a stale cursor page and quietly
     * convince it that it is up to date; a replayed auth response would answer
     * for a device whose token was revoked ten minutes ago, which is the one
     * thing §4.4 promises a revoke does not survive.
     *
     * Offline, this fails fast, which is exactly what the sync engine expects:
     * it counts an unreachable server as `offline` and drains the outbox when
     * signal returns.
     */
    matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
  {
    /**
     * The document itself — the app shell.
     *
     * Network first, so a screen that can reach the server always renders the
     * current build, and the cached copy is a fallback rather than the source.
     * Two departures from `defaultCache`'s equivalent, both about the barn:
     *
     * `networkTimeoutSeconds` is short because the failure that matters here is
     * not "no network", which the browser reports immediately, but a wifi
     * bridge that accepts the connection and then says nothing. Without a
     * timeout the screen sits blank waiting for it; with one it falls back to
     * the copy it already has, which is a working app.
     *
     * The entries live for a month rather than a day. A 24-hour expiry means a
     * kiosk that spends a weekend out of signal wakes up with its own shell
     * expired out from under it — offline, with nothing to serve, holding a
     * local store full of data it can no longer draw.
     */
    matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
    handler: new NetworkFirst({
      cacheName: APP_SHELL_CACHE,
      networkTimeoutSeconds: 4,
      plugins: [
        onlyPlainDocuments,
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: APP_SHELL_MAX_AGE_SECONDS,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  /**
   * **Deliberately false, and the update path in `lib/sw-update.ts` is why.**
   *
   * Skipping the wait unconditionally swaps the worker under a page that is
   * already running, and a Next build's chunks are content-hashed: the open
   * document then asks for a lazily-loaded chunk the new precache has already
   * swept away, and the screen breaks on the next tap rather than at a moment
   * anyone can connect to a deploy. So a new build waits — and because a wall-
   * mounted screen would then wait forever, the client asks for it explicitly
   * and reloads the moment it takes over. Waiting is safe only when something
   * ends the wait; issue #11 asks for both halves.
   */
  skipWaiting: false,
  /**
   * Claim on activation, so the first visit is protected without a reload —
   * and so that `controllerchange` fires when a later build takes over, which
   * is the signal the client reloads on.
   */
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        /**
         * Somewhere honest to land when a document is wanted that this device
         * has never seen and cannot fetch. Precached by `next.config.ts` — a
         * fallback that needed the network would be no fallback at all.
         *
         * Scoped to documents on purpose: an image or a stylesheet that cannot
         * be fetched should fail as itself, not resolve to a page of HTML.
         */
        url: OFFLINE_ROUTE,
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

/**
 * Web push (spec §6, issue #41).
 *
 * Deliberately below `addEventListeners()` and deliberately touching nothing
 * above it: the caching and update policy is settled (#35) and load-bearing for
 * the barn screens. These are two more listeners on the same worker, added the
 * way any other listener would be, and Serwist neither knows nor cares.
 *
 * A worker is the only place a notification can be shown when the app is
 * closed, which is the entire reason push exists here — a tank-freeze warning
 * that waits for somebody to open the app is a warning that arrives after the
 * freeze.
 */

/** The app's own icon, so a notification is recognisable on a lock screen. */
const NOTIFICATION_ICON = "/icons/icon-192.png";

self.addEventListener("push", (event) => {
  // Read synchronously. `event.data` is not available once the handler has
  // yielded, and a payload read after an await is a payload that is gone.
  const payload = parsePushPayload(event.data?.text());

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: NOTIFICATION_ICON,
      // Where the tap goes. Carried on the notification rather than in a
      // closure, because `notificationclick` may fire in a worker that has
      // since been killed and restarted — a variable would not survive that,
      // and the notification does.
      data: { url: payload.url },
      /**
       * Every notification stands on its own.
       *
       * A `tag` would let a second notification replace the first, which
       * sounds tidy and is wrong here: "Andromeda is calving" and "Dolly is
       * calving" are the same trigger about different cows, and collapsing
       * them loses one of the two animals.
       */
    }),
  );
});

/**
 * A tap on a notification.
 *
 * The behaviour worth naming is the focus: a farm phone that already has the
 * app open should come back to *that* window rather than get a second copy of
 * an app whose whole state is a local database — two windows means two sync
 * loops and a person wondering which one is real. So an existing window on
 * this origin is focused and steered, and a new one is opened only when there
 * is nothing to come back to.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(
    (event.notification.data as { url?: string } | undefined)?.url ?? "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      // `includeUncontrolled` because a window opened before this worker took
      // over is still the window somebody is looking at.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;

        await client.focus();
        if (client.url !== target) {
          // Not every browser allows a worker to navigate a client it does not
          // control. Focusing already got somebody to the app, so a refused
          // navigation is a worse landing rather than a failure.
          await client.navigate(target).catch(() => undefined);
        }
        return;
      }

      await self.clients.openWindow(target);
    })(),
  );
});
