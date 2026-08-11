"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Badge } from "@galaxy-farm/ui";

import { useSync } from "@/app/_components/sync-provider";

/**
 * The admin navigation (spec §7).
 *
 * Grouped by domain rather than flattened, because §7 has fifty-five routes
 * and a flat list of fifty-five is not navigation. The groups match the way
 * the farm is actually divided — cattle, chickens, garden, equipment — which
 * is how someone thinks about where they are going.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
}

interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
  {
    label: "Today",
    items: [
      { href: "/admin", label: "Dashboard" },
      { href: "/admin/calendar", label: "Calendar" },
      { href: "/admin/chores", label: "Chores" },
      { href: "/admin/map", label: "Property map" },
    ],
  },
  {
    label: "Cattle",
    items: [
      { href: "/admin/cattle", label: "Herd" },
      { href: "/admin/cattle/breeding", label: "Breeding" },
      { href: "/admin/cattle/calving", label: "Calving" },
      { href: "/admin/cattle/health", label: "Health" },
      { href: "/admin/cattle/feed", label: "Feed plans" },
      { href: "/admin/cattle/sales", label: "Sales" },
      { href: "/admin/cattle/roadmap", label: "Roadmap" },
      { href: "/admin/cattle/candidates", label: "Candidates" },
    ],
  },
  {
    label: "Land",
    items: [
      { href: "/admin/pastures", label: "Pastures" },
      { href: "/admin/garden/plantings", label: "Garden" },
      { href: "/admin/garden/harvest", label: "Harvest" },
    ],
  },
  {
    label: "Flock",
    items: [
      { href: "/admin/chickens/flock", label: "Flocks" },
      { href: "/admin/chickens/eggs", label: "Eggs" },
    ],
  },
  {
    label: "Kit",
    items: [
      { href: "/admin/equipment", label: "Equipment" },
      { href: "/admin/feed", label: "Feed inventory" },
      { href: "/admin/supplies", label: "Supplies" },
    ],
  },
  {
    label: "People & places",
    items: [
      { href: "/admin/contacts", label: "Contacts" },
      { href: "/admin/pets", label: "Pets" },
      { href: "/admin/horses", label: "Horses" },
      { href: "/admin/housesitter", label: "Housesitter" },
      { href: "/admin/reports", label: "Reports" },
      { href: "/admin/settings", label: "Settings" },
    ],
  },
];

/**
 * Is this the route we are on?
 *
 * Exact match only. A `startsWith` check would light up "Herd" while someone
 * is on the breeding page, and a nav that lies about where you are is worse
 * than one that says nothing.
 */
export function isCurrent(href: string, pathname: string): boolean {
  return href === pathname;
}

export function AdminNav({ farmName }: { readonly farmName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-2 p-density">
      <div className="flex items-center justify-between gap-2">
        <Link href="/admin" className="font-heading text-lg font-semibold text-ink">
          {farmName}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-controls="admin-nav-groups"
          className="min-h-target rounded-density border border-edge px-3 text-density text-ink md:hidden"
        >
          Menu
        </button>
      </div>

      <SyncBadge />

      <div
        id="admin-nav-groups"
        // Hidden on a phone until asked for, always visible from tablet up.
        // `hidden` rather than unmounting, so the state of anything inside
        // survives opening and closing it.
        className={`${open ? "flex" : "hidden"} flex-col gap-4 md:flex`}
      >
        {NAV.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {group.label}
            </h2>
            <ul className="flex flex-col">
              {group.items.map((item) => {
                const current = isCurrent(item.href, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      // The one thing a screen reader needs from a nav: which
                      // of these is the page I am on.
                      aria-current={current ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-target items-center rounded-density px-2 text-density ${
                        current ? "bg-panel font-semibold text-ink" : "text-muted hover:text-ink"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * Whether the device is caught up.
 *
 * Worth showing, and worth showing calmly. Offline is the expected state in a
 * barn, not a failure — what someone needs to know is that their work is
 * queued and safe, not that something went wrong.
 */
function SyncBadge() {
  const { offline, syncing, pending } = useSync();

  if (syncing) return <Badge tone="neutral">Syncing…</Badge>;
  if (offline) {
    return <Badge tone="calm">Offline{pending > 0 ? ` · ${pending} queued` : ""}</Badge>;
  }
  if (pending > 0) return <Badge tone="action">{pending} to send</Badge>;
  return <Badge tone="calm">Up to date</Badge>;
}
