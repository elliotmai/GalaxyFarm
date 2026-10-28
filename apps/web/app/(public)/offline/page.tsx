import Link from "next/link";

import { Logomark } from "@galaxy-farm/ui";

/**
 * The offline fallback (spec §3, §7).
 *
 * What the service worker serves when a document is asked for that this device
 * has never loaded and cannot fetch — a link followed to a screen nobody has
 * opened here before, with the barn wifi down. Every screen that *has* been
 * opened comes back from the cache instead; this is the honest answer for the
 * ones that have not, in place of the browser's dinosaur.
 *
 * **Static, and precached.** `next.config.ts` puts this page in the precache
 * manifest, so it is on the device before it is ever needed. A fallback that
 * had to be fetched would be no fallback at all, which is why nothing on it may
 * depend on a request: no session, no store, no data.
 *
 * It lives on the public surface — daylight, no session — because that is the
 * one surface a page with no session can honestly belong to. The trade is that
 * a barn screen landing here at night gets a light page; it is also the one
 * screen in the app that is by definition not being worked on.
 */

export const dynamic = "force-static";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <Logomark size="large" decorative />
        <h1 className="text-ink">No signal, and this screen is not on the device yet</h1>
        <p className="text-muted">
          The app works offline, but this screen has never been opened here. Anything logged offline
          is saved and sent once there is signal.
        </p>
      </div>
      {/* Both entry points, because the two screens most likely to land here
          are a phone in a pasture and a barn kiosk, and each has a home the
          other does not. `prefetch={false}`: there is nothing to prefetch
          with — the network is down, which is why this page is on screen. */}
      <div className="flex w-full max-w-sm flex-col gap-2 sm:flex-row">
        <Link
          className="inline-flex min-h-target flex-1 items-center justify-center rounded-density bg-action px-4 font-semibold text-action-ink"
          href="/admin"
          prefetch={false}
        >
          Open Today
        </Link>
        <Link
          className="inline-flex min-h-target flex-1 items-center justify-center rounded-density border border-edge bg-panel px-4 font-semibold text-ink hover:bg-raised"
          href="/kiosk"
          prefetch={false}
        >
          Kiosk boards
        </Link>
      </div>
    </main>
  );
}
