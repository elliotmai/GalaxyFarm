import Link from "next/link";

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
    <main className="flex min-h-screen flex-col items-center justify-center gap-density p-6 text-center">
      <h1 className="text-ink">No signal, and this screen is not on the device yet</h1>
      <p className="max-w-prose text-muted">
        The app itself is installed and works without a connection — but this particular screen has
        not been opened on this device before, so there is no copy of it here to show you.
      </p>
      <p className="max-w-prose text-muted">
        Anything logged while offline is saved on the device and sent up on its own once there is
        signal again. Nothing is waiting on this page.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-density">
        {/* Both entry points, because the two screens most likely to land here
            are a phone in a pasture and a barn kiosk, and each has a home the
            other does not. `prefetch={false}`: there is nothing to prefetch
            with — the network is down, which is why this page is on screen. */}
        <Link className="text-action underline" href="/admin" prefetch={false}>
          Open the dashboard
        </Link>
        <Link className="text-action underline" href="/kiosk" prefetch={false}>
          Open the kiosk boards
        </Link>
      </div>
    </main>
  );
}
