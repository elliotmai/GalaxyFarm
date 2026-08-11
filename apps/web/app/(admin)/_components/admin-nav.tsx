"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Badge, Logomark } from "@galaxy-farm/ui";

import { useSync } from "@/app/_components/sync-provider";
import { NAV, groupContaining, isCurrent, isWithin } from "@/app/(admin)/_components/nav-groups";

export { NAV, isCurrent } from "@/app/(admin)/_components/nav-groups";

/**
 * The admin navigation (spec §7).
 *
 * Two things it has to get right that a list of links does not do for free.
 *
 * **It keeps its scroll.** The sidebar scrolls in its own right rather than
 * with the page, so the layout — which Next does not remount between routes —
 * holds its scroll position across a navigation. Somebody who has scrolled
 * down to Business and clicked Invoices should still be looking at Business.
 * The position is also written to sessionStorage, because a full reload does
 * remount and landing back at the top after every refresh is the same
 * annoyance in slower motion.
 *
 * **It collapses.** Fifty-five routes is a wall. Everything touched daily is
 * open; the rest starts closed, remembers being opened, and the group holding
 * the current route opens itself so a deep link never lands you somewhere the
 * nav cannot show you.
 */

const OPEN_GROUPS_KEY = "galaxy-farm:nav-open-groups";
const SCROLL_KEY = "galaxy-farm:nav-scroll";

function readOpenGroups(): Set<string> | undefined {
  try {
    const raw = globalThis.sessionStorage?.getItem(OPEN_GROUPS_KEY);
    if (raw === null || raw === undefined) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === "string"))
      : undefined;
  } catch {
    // Private browsing, a full quota, a value somebody hand-edited — none of
    // which is a reason for the nav not to render.
    return undefined;
  }
}

/** Groups open on first paint: the ones not marked collapsed by default. */
export function defaultOpenGroups(): string[] {
  return NAV.filter((group) => group.collapsedByDefault !== true).map((group) => group.label);
}

export function AdminNav({ farmName }: { readonly farmName: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpenGroups()));
  const scroller = useRef<HTMLDivElement | null>(null);

  // Restored in an effect, not in the initial state: sessionStorage does not
  // exist during the server render, and a state initialiser that reads it
  // makes the first client render disagree with the HTML.
  useEffect(() => {
    const stored = readOpenGroups();
    const current = groupContaining(pathname);
    setOpen(
      new Set([
        ...(stored ?? new Set(defaultOpenGroups())),
        ...(current === undefined ? [] : [current]),
      ]),
    );

    const element = scroller.current;
    const saved = Number(globalThis.sessionStorage?.getItem(SCROLL_KEY) ?? "0");
    if (element !== null && Number.isFinite(saved)) element.scrollTop = saved;
    // Deliberately once, on mount, and `pathname` is deliberately not a
    // dependency: re-running on navigation would fight the scroll position
    // that is the whole thing being preserved. The route-arrival case is
    // handled by the effect below, which only ever *adds* an open group.
  }, []);

  // Opening the group that holds the route we just navigated to, without
  // touching anything else the person has opened or closed.
  //
  // The menu closes on the same beat. On a phone it covers the screen, so
  // leaving it open after a tap means arriving at the page you asked for and
  // seeing none of it.
  useEffect(() => {
    setMenuOpen(false);

    const current = groupContaining(pathname);
    if (current === undefined) return;
    setOpen((was) => (was.has(current) ? was : new Set([...was, current])));
  }, [pathname]);

  function toggle(label: string): void {
    setOpen((was) => {
      // Rebuilt by filtering rather than by mutating a copy. `Set.delete` is
      // not a record deletion, but the §4.5 guard reads call sites and not
      // types, and teaching people to annotate their way past it is how a real
      // unconfirmed delete eventually slips through behind the same comment.
      const next = was.has(label)
        ? new Set([...was].filter((entry) => entry !== label))
        : new Set([...was, label]);
      try {
        globalThis.sessionStorage?.setItem(OPEN_GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        // See `readOpenGroups` — storage being unavailable is not fatal here.
      }
      return next;
    });
  }

  function rememberScroll(): void {
    try {
      globalThis.sessionStorage?.setItem(SCROLL_KEY, String(scroller.current?.scrollTop ?? 0));
    } catch {
      /* not fatal */
    }
  }

  return (
    <nav
      aria-label="Admin sections"
      // Open on a phone, the nav *is* the screen. Fixed over everything rather
      // than pushed into the page flow: nine groups of links is several phone
      // screens tall, and in the flow it shoves the content down past where
      // anybody will scroll to find it. Covering the screen also means the
      // page behind cannot be scrolled by accident while the menu is up.
      //
      // A single fixed element, with the bar inside it, so there is no
      // measured offset between a sticky header and the panel below it — the
      // kind of magic number that is right on one phone and wrong on the next.
      className={`flex flex-col md:static md:h-full ${
        menuOpen ? "fixed inset-0 z-40 h-[100dvh] bg-canvas" : "h-full"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-edge px-density py-3">
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
          aria-controls="admin-nav-groups"
          className="min-h-target min-w-target rounded-density border border-edge px-3 text-density text-ink md:hidden"
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>

      <div className="border-b border-edge px-density py-2">
        <SyncBadge />
      </div>

      <div
        id="admin-nav-groups"
        ref={scroller}
        onScroll={rememberScroll}
        // `hidden` rather than unmounting on a phone, so anything open inside
        // survives closing and reopening the menu.
        //
        // `overscroll-contain` so reaching the end of the list does not hand
        // the scroll to the page behind — or, on a phone, trigger the
        // browser's own pull-to-refresh out of a menu.
        className={`${menuOpen ? "flex" : "hidden"} min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-2 pb-[env(safe-area-inset-bottom)] pt-density md:flex`}
      >
        {NAV.map((group) => {
          const expanded = open.has(group.label);
          const holdsCurrent = group.items.some((item) => isWithin(item, pathname));

          return (
            <div key={group.label} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggle(group.label)}
                aria-expanded={expanded}
                aria-controls={`nav-group-${group.label.replace(/\W+/g, "-")}`}
                className="flex min-h-target items-center justify-between gap-2 rounded-density px-2 text-left text-xs font-semibold uppercase tracking-widest text-muted hover:text-ink"
              >
                <span className="flex items-center gap-2">
                  {group.label}
                  {/* A closed group holding the current page still says so. */}
                  {!expanded && holdsCurrent ? (
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-action" />
                  ) : null}
                </span>
                <span aria-hidden className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
                  ›
                </span>
              </button>

              <ul
                id={`nav-group-${group.label.replace(/\W+/g, "-")}`}
                className={`${expanded ? "flex" : "hidden"} flex-col border-l border-edge pl-2 ml-3`}
              >
                {group.items.map((item) => {
                  const current = isCurrent(item.href, pathname);
                  const within = isWithin(item, pathname);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        // The one thing a screen reader needs from a nav: which
                        // of these is the page I am on.
                        aria-current={current ? "page" : undefined}
                        onClick={() => {
                          rememberScroll();
                          setMenuOpen(false);
                        }}
                        className={`flex min-h-target items-center rounded-density px-2 text-density ${
                          within
                            ? "bg-panel font-semibold text-ink shadow-[inset_2px_0_0_0_var(--color-action)]"
                            : "text-muted hover:bg-panel/60 hover:text-ink"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
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
