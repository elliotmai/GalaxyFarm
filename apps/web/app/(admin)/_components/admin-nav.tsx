"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge, Logomark } from "@galaxy-farm/ui";

import { useSync } from "@/app/_components/sync-provider";
import { NAV, UTILITY, destinationFor, isWithin } from "@/app/(admin)/_components/nav-groups";

export { NAV, isCurrent } from "@/app/(admin)/_components/nav-groups";

/**
 * The admin navigation (spec §7, §8 v0.9).
 *
 * Five destinations and a quieter utility rail beneath them. It used to be nine
 * collapsing groups over fifty-five links, which needed remembered open state,
 * remembered scroll position, and a dot to mark the closed group holding the
 * current page — a lot of machinery to make a wall survivable. None of that is
 * here because none of it is needed: nine rows do not scroll, do not collapse
 * and cannot lose their place.
 *
 * The views that used to be rows are tab strips on the screens they belong to.
 * See `SectionStrip` and `nav-groups.ts` for where each one went.
 */

export function AdminNav({ farmName }: { readonly farmName: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = destinationFor(pathname);

  // On a phone the menu covers the screen, so leaving it open after a tap means
  // arriving at the page you asked for and seeing none of it.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <nav
      aria-label="Admin sections"
      className={`flex flex-col md:static md:h-full ${
        menuOpen ? "fixed inset-0 z-40 h-[100dvh] bg-canvas" : "h-full"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-rule px-density py-3">
        <Link
          href="/admin"
          className="flex min-w-0 items-center gap-2 font-heading text-lg font-semibold text-ink"
        >
          <Logomark size="small" decorative />
          <span className="truncate">{farmName}</span>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((was) => !was)}
          aria-expanded={menuOpen}
          aria-controls="admin-nav-destinations"
          className="min-h-target min-w-target rounded-density border border-edge px-3 text-density text-ink md:hidden"
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>

      <div className="border-b border-rule px-density py-2">
        <SyncBadge />
      </div>

      <div
        id="admin-nav-destinations"
        // `hidden` rather than unmounted on a phone, so nothing inside is
        // rebuilt every time the menu is opened.
        className={`${menuOpen ? "flex" : "hidden"} min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-2 pb-[env(safe-area-inset-bottom)] pt-density md:flex`}
      >
        {NAV.map((destination) => {
          const here = current?.href === destination.href;

          return (
            <Link
              key={destination.href}
              href={destination.href}
              aria-current={here ? "page" : undefined}
              className={`flex min-h-target items-center gap-3 rounded-density px-3 text-density ${
                here ? "bg-action/10 font-semibold text-ink" : "text-muted hover:bg-raised"
              }`}
            >
              <span aria-hidden className="w-4 shrink-0 text-center text-action">
                {destination.glyph}
              </span>
              {destination.label}
            </Link>
          );
        })}

        <hr className="my-density border-rule" />

        {UTILITY.map((item) => {
          const here = isWithin(item, pathname);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={here ? "page" : undefined}
              className={`flex min-h-target items-center rounded-density px-3 text-sm ${
                here ? "font-semibold text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Whether the device is caught up.
 *
 * Offline is worth showing calmly: it is the expected state in a barn, not a
 * failure, and what someone needs to know is that their work is queued and
 * safe. A server that answered and refused is the opposite — it will still be
 * broken tomorrow — and showing that as "Offline" is what let a deploy sit
 * ahead of its migrations with nothing but a red line in a browser console to
 * say so.
 */
function SyncBadge() {
  const { offline, problem, syncing, pending, stuck, retryStuck } = useSync();

  // Set-aside entries first: they are the only state here that will not fix
  // itself, and the only one with something for a person to do about it.
  if (stuck > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">{stuck} not sent</Badge>
        <button
          type="button"
          onClick={() => void retryStuck()}
          className="min-h-target text-sm text-action underline underline-offset-4"
        >
          Try again
        </button>
      </div>
    );
  }

  if (syncing) return <Badge tone="neutral">Syncing…</Badge>;
  if (problem !== undefined) {
    return (
      <Badge tone="danger" title={problem}>
        Sync failing{pending > 0 ? ` · ${pending} queued` : ""}
      </Badge>
    );
  }
  if (offline) {
    return <Badge tone="calm">Offline{pending > 0 ? ` · ${pending} queued` : ""}</Badge>;
  }
  if (pending > 0) return <Badge tone="action">{pending} to send</Badge>;
  return <Badge tone="calm">Up to date</Badge>;
}
