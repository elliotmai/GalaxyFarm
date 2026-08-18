import type { Viewport } from "next";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";

import { PwaShell } from "@/app/_components/pwa-shell";
import { SyncProvider } from "@/app/_components/sync-provider";
import { currentActor } from "@/lib/auth";

/**
 * The browser chrome, matched to the surface (spec §8 v0.9).
 *
 * This surface runs `flying-auto`, so on a device set to dark the page is the
 * night canvas — and the root layout's light chrome would sit above it as a
 * bar of the wrong colour across the top of every screen. Overridden here
 * rather than at the root because `/account` and the public pages stay light
 * whatever the device says.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0F1419" },
    { media: "(prefers-color-scheme: light)", color: "#F5F6F8" },
  ],
};

/**
 * kiosk surface. Daylight by default, night when the screen is set to it
 * (spec §8 v0.9) — this is the surface `flying-night` was drawn for. A barn
 * screen at four in the morning during calving is the one place in this app
 * where a white page is not neutral but a torch in the face.
 *
 * Density is fixed here, and only here. A kiosk is a known screen at a known
 * distance, pressed with a gloved hand in February — 64px targets, not
 * whatever the viewport width would have suggested. Every other surface lets
 * the viewport decide.
 */
export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();

  // Not `redirect("/login")` here the way the other surfaces do it: this
  // layout wraps `/kiosk/pair` too, and `middleware.ts` carries the one
  // exception that lets a signed-out screen reach it — pairing is how it gets
  // a session. Rendering the bare shell rather than a login wall is what
  // makes that exception actually usable, and a real session past this point
  // is guaranteed for every other route the middleware already gates.
  if (actor === undefined) {
    return (
      <div data-surface="kiosk" data-theme="flying-auto" data-density="kiosk">
        <main className="p-density">{children}</main>
        <PwaShell unattended />
      </div>
    );
  }

  return (
    <div data-surface="kiosk" data-theme="flying-auto" data-density="kiosk">
      {/* Off for a kiosk device (spec §4.3): its outbox is always empty —
          writes go through the server actions in `kiosk/_actions.ts` rather
          than `useMutations` — and `/api/sync/push` refuses anything that is
          not `owner` or `member` outright. Pulling stays on regardless of
          role: reads are the entire reason a barn screen keeps a local store. */}
      <SyncProvider pushEnabled={actor.role === "owner" || actor.role === "member"}>
        <ToastProvider>
          <ConfirmProvider>
            <main className="p-density">{children}</main>
          </ConfirmProvider>
        </ToastProvider>
      </SyncProvider>
      {/* `unattended`: a screen on a barn wall is never reloaded by hand, so it
          applies a new build itself once it has sat untouched for a minute.
          Both branches carry it — a screen waiting to be paired is on the same
          wall and needs the same treatment. */}
      <PwaShell unattended />
    </div>
  );
}
