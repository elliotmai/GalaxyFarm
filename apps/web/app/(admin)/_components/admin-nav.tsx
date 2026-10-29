"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Badge, Logomark } from "@galaxy-farm/ui";
import type { Ulid } from "@galaxy-farm/core";

import { useSync } from "@/app/_components/sync-provider";
import { LOG_HREF, NAV, destinationFor } from "@/app/(admin)/_components/nav-groups";
import { logHref } from "@/app/(admin)/admin/log/_components/log-kinds";
import { useSearchPalette } from "@/app/(admin)/_components/search-palette";
import { useFarmName } from "@/lib/branding";

export { NAV, isCurrent } from "@/app/(admin)/_components/nav-groups";

/**
 * The admin navigation (spec §7, §8 v1.7).
 *
 * Four places — Today, Animals, Farm, More — and Log between them. On a phone
 * they are a tab bar along the bottom (`BottomTabs`), where a thumb already
 * is, with Log as the raised button in the middle; this component is then
 * only the top bar: the farm, the sync state when it has something to say,
 * and search. On a laptop it is the rail: the same four, Log as the primary
 * button above them, and search with its ⌘K.
 *
 * There is no Menu and no utility rail any more. Everything that lived there
 * is on the More page, which is one tap from anywhere rather than a drawer
 * over the page.
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
  "/admin/animals": (
    <>
      <path d="M4 8c0-2 1-3 3-3M20 8c0-2-1-3-3-3" />
      <path d="M6 8h12v5a6 6 0 0 1-12 0z" />
    </>
  ),
  "/admin/feed": <path d="M3 18l6-9 4 6 3-4 5 7z" />,
  "/admin/more": (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
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

function PlusIcon({ size }: { readonly size: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
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
  const current = destinationFor(pathname);
  // Read here rather than passed down from the layout: the layout is a server
  // component and cannot see the device, so a name saved in Settings would sit
  // there unread until a deploy.
  const name = useFarmName(propertyId, farmName);
  const search = useSearchPalette();

  return (
    <nav aria-label="Admin sections" className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-rule px-density py-3 md:border-b-0">
        <Link href="/admin" className="flex min-w-0 items-center gap-2 text-ink">
          <Logomark size="small" decorative />
          <span className="truncate">{name}</span>
        </Link>
        <button
          type="button"
          onClick={search.open}
          aria-label="Search"
          className="flex min-h-target min-w-target items-center justify-center rounded-full border border-rule bg-panel text-ink md:hidden"
        >
          <SearchIcon />
        </button>
      </div>

      {/* On a phone the sync state only takes a row when it has something to
          say; "Up to date" on every screen is a line nobody reads. */}
      <div className="px-density pb-2 empty:hidden md:hidden">
        <SyncBadge quiet />
      </div>

      <div className="hidden min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-density md:flex">
        <div className="flex flex-col gap-2 px-2">
          <SyncBadge />
          <button
            type="button"
            onClick={search.open}
            className="flex h-10 items-center gap-2 rounded-density border border-rule bg-canvas px-3 text-sm text-muted hover:text-ink"
          >
            <SearchIcon />
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-rule bg-panel px-1.5 text-xs">⌘K</kbd>
          </button>
          <Link
            href={logHref({ from: pathname })}
            prefetch
            aria-current={pathname === LOG_HREF ? "page" : undefined}
            className="flex min-h-target items-center justify-center gap-2 rounded-density bg-action px-3 text-density font-semibold text-action-ink"
          >
            <PlusIcon size={18} />
            Log
          </Link>
        </div>

        <div className="mt-2 flex flex-col gap-1">
          {NAV.map((destination) => {
            const here = current?.href === destination.href;

            return (
              <Link
                key={destination.href}
                href={destination.href}
                // See `next.config.ts`. Next's default stops a dynamic route's
                // prefetch at the loading boundary, so the skeleton arrives
                // early and the page itself is still a round trip away when it
                // is clicked. Four destinations is a small set to fetch whole.
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
        </div>
      </div>
    </nav>
  );
}

/**
 * Today, Animals, Log, Farm, More along the bottom of a phone.
 *
 * Where a thumb rests, always on screen, one tap from anywhere to anywhere.
 * Log is the raised button in the middle because it is the thing done from
 * every screen. Hidden from a laptop, which has the rail. The page reserves
 * room for it (see the admin layout) so the last row of a list is never under
 * the bar.
 */
export function BottomTabs() {
  const pathname = usePathname();
  const current = destinationFor(pathname);
  const tab = (destination: (typeof NAV)[number]) => {
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
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex items-end border-t border-rule bg-panel px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV.slice(0, 2).map(tab)}
      <Link
        href={logHref({ from: pathname })}
        prefetch
        aria-label="Log something"
        aria-current={pathname === LOG_HREF ? "page" : undefined}
        className="flex min-h-14 flex-1 flex-col items-center justify-end gap-0.5 pb-1 text-[11px] font-semibold text-action"
      >
        <span className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-action text-action-ink shadow-[0_6px_16px_rgba(27,58,92,0.35)]">
          <PlusIcon size={26} />
        </span>
        Log
      </Link>
      {NAV.slice(2).map(tab)}
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
