"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Badge, Logomark } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";

import { useSync } from "@/app/_components/sync-provider";
import { NAV, UTILITY, destinationFor, isWithin } from "@/app/(admin)/_components/nav-groups";
import { useSearchPalette } from "@/app/(admin)/_components/search-palette";
import { useFarmName } from "@/lib/branding";

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
 *
 * On a phone the five live in a tab bar along the bottom (`BottomTabs`), where
 * a thumb already is, and this collapses to a top bar: the farm, the sync
 * state, search, and a Menu for the quieter rail. Opening a menu to change
 * section was two taps for the thing done most often.
 */

/**
 * Line icons, one per destination, drawn inline so the rail costs no icon set
 * and nothing to download. Keyed by href so the data in `nav-groups.ts` stays
 * free of markup.
 */
const ICONS: Readonly<Record<string, ReactNode>> = {
  "/admin": (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  "/admin/cattle": (
    <>
      <path d="M4 8c0-2 1-3 3-3M20 8c0-2-1-3-3-3" />
      <path d="M6 8h12v5a6 6 0 0 1-12 0z" />
    </>
  ),
  "/admin/pastures": <path d="M3 18l6-9 4 6 3-4 5 7z" />,
  "/admin/equipment": (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5h8v2" />
    </>
  ),
  "/admin/business/bookings": (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
};

export function NavIcon({ href, size = 20 }: { readonly href: string; readonly size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {ICONS[href] ?? <circle cx="12" cy="12" r="3" />}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function AdminNav({
  propertyId,
  farmName,
}: {
  readonly propertyId: Ulid;
  /** What the server rendered. Stands until the device answers with a name. */
  readonly farmName: string;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = destinationFor(pathname);
  // Read here rather than passed down from the layout: the layout is a server
  // component and cannot see the device, so a name saved in Settings would sit
  // there unread until a deploy.
  const name = useFarmName(propertyId, farmName);
  const search = useSearchPalette();

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
        <Link href="/admin" className="flex min-w-0 items-center gap-2 text-ink">
          <Logomark size="small" decorative />
          <span className="truncate">{name}</span>
        </Link>
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={search.open}
            aria-label="Search"
            className="flex min-h-target min-w-target items-center justify-center rounded-full border border-rule bg-panel text-ink"
          >
            <SearchIcon />
          </button>
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
      </div>

      {/* On a phone the sync state only takes a row when it has something to
          say; "Up to date" on every screen is a line nobody reads. */}
      <div className="px-density pb-2 empty:hidden md:hidden">
        <SyncBadge quiet />
      </div>
      <div className="hidden flex-col gap-2 px-density pt-3 md:flex">
        <SyncBadge />
        <button
          type="button"
          onClick={search.open}
          className="hidden h-10 items-center gap-2 rounded-density border border-rule bg-canvas px-3 text-sm text-muted hover:text-ink md:flex"
        >
          <SearchIcon />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-rule bg-panel px-1.5 text-xs">⌘K</kbd>
        </button>
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
              // See `next.config.ts`. Next's default stops a dynamic route's
              // prefetch at the loading boundary, so the skeleton arrives early
              // and the page itself is still a round trip away when it is
              // clicked. Nine destinations is a small enough set to fetch
              // whole, and it is the set that gets clicked all day.
              prefetch
              aria-current={here ? "page" : undefined}
              className={`flex min-h-target items-center gap-3 rounded-density px-3 text-density ${
                here ? "bg-action/10 font-semibold text-ink" : "text-ink hover:bg-raised"
              }`}
            >
              <span className={here ? "text-action" : "text-muted"}>
                <NavIcon href={destination.href} />
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
              prefetch
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
 * The five destinations along the bottom of a phone.
 *
 * Where a thumb rests, always on screen, one tap from anywhere to anywhere.
 * Hidden from a laptop, which has the rail. The page reserves room for it (see
 * the admin layout) so the last row of a list is never under the bar.
 */
export function BottomTabs() {
  const pathname = usePathname();
  const current = destinationFor(pathname);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-rule bg-panel px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV.map((destination) => {
        const here = current?.href === destination.href;

        return (
          <Link
            key={destination.href}
            href={destination.href}
            prefetch
            aria-current={here ? "page" : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
              here ? "font-semibold text-action" : "font-medium text-muted"
            }`}
          >
            <NavIcon href={destination.href} size={22} />
            {destination.label}
          </Link>
        );
      })}
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
function SyncBadge({ quiet = false }: { readonly quiet?: boolean }) {
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
  return quiet ? null : <Badge tone="calm">Up to date</Badge>;
}
