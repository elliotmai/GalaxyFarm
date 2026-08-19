import type { Viewport } from "next";
import { redirect } from "next/navigation";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";

import { AdminNav } from "@/app/(admin)/_components/admin-nav";
import { Refreshable } from "@/app/(admin)/_components/refreshable";
import { SectionStrip } from "@/app/(admin)/_components/section-strip";
import { PwaShell } from "@/app/_components/pwa-shell";
import { SyncProvider } from "@/app/_components/sync-provider";
import { currentActor } from "@/lib/auth";
import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";

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
 * The admin surface. Theme is fixed per surface (spec §8): flying-day.
 *
 * The session is checked here as well as in the middleware. Middleware is a
 * routing concern and can be bypassed by anything that reaches a server
 * component another way; this is the layer that actually has the actor.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin");

  // Farm name is a BrandingConfig value (§5.1), edited in Settings and stored
  // on the device. This is only the first paint: `AdminNav` reads the stored
  // name itself and prefers it. A server component cannot — the value lives in
  // IndexedDB, and reading it from Postgres here would put a database round
  // trip in front of every admin page, which is the one thing §4.2 spends the
  // whole local-first design avoiding.
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;

  return (
    <div data-surface="admin" data-theme="flying-auto">
      <SyncProvider>
        <ToastProvider>
          <ConfirmProvider>
            <div className="flex min-h-screen flex-col md:flex-row">
              {/*
                Sticky and full height so the sidebar scrolls in its own right.
                That is what preserves its position across a navigation: the
                layout does not remount, so the scrolled element survives — and
                a nav that jumps back to the top every time you click a link is
                the thing that makes a long list unusable.
              */}
              {/*
                Sticky on both, for two different reasons. On a laptop it is a
                full-height column that scrolls in its own right, which is what
                preserves its position across a navigation — the layout does
                not remount, so the scrolled element survives, and a nav that
                jumps to the top on every click makes a long list unusable.

                On a phone it is a bar: the farm name, the sync state, and the
                Menu button. Sticking that means the way out of a page is still
                on screen forty rows into the herd, rather than back at the top
                where you would have to scroll to reach it.
              */}
              <aside className="sticky top-0 z-20 border-b border-edge bg-panel md:h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r">
                <AdminNav propertyId={actor.propertyId} farmName={farmName} />
              </aside>
              {/* Tighter gutters on a phone: 14px of padding either side of a
                  375px screen is 7% of the width, and every table and form
                  inside is competing for the rest. */}
              <main className="min-w-0 flex-1 px-3 py-density md:p-density">
                <Refreshable>
                  {/*
                    In the layout rather than in each screen, so a page cannot
                    forget it and so it survives a navigation without
                    remounting — which is what keeps a thirteen-tab strip from
                    losing its scroll every time you change view.
                  */}
                  <SectionStrip />
                  {children}
                </Refreshable>
              </main>
            </div>
          </ConfirmProvider>
        </ToastProvider>
      </SyncProvider>
      <PwaShell />
    </div>
  );
}
