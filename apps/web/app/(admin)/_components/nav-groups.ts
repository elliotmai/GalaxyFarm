/**
 * The shape of the admin nav (spec §7).
 *
 * Split from the component so the route-map test can read it without
 * rendering React, and so the nesting is visible as data rather than as JSX.
 *
 * Two levels, because §7 has fifty-five routes and one flat list of fifty-five
 * is not navigation. The groups match how the farm is actually divided; the
 * subsections inside Cattle match the way §7 itself divides it.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /**
   * Routes that should light this item up as well as its own.
   *
   * `/admin/cattle/01ARZ…` is the herd list's child, and a nav that goes dark
   * the moment you open a cow makes the app feel like it lost you.
   */
  readonly owns?: readonly string[];
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
  /**
   * Closed until asked for.
   *
   * Everything a person touches daily stays open; the rest starts collapsed so
   * the sidebar is a short list rather than a wall. Somebody who opens a group
   * has it remembered.
   */
  readonly collapsedByDefault?: boolean;
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
      { href: "/admin/cattle", label: "Herd", owns: ["/admin/cattle/"] },
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
    collapsedByDefault: true,
    items: [
      { href: "/admin/pastures", label: "Pastures" },
      { href: "/admin/garden/layout", label: "Garden layout" },
      { href: "/admin/garden/plantings", label: "Plantings" },
      { href: "/admin/garden/seeds", label: "Seeds" },
      { href: "/admin/garden/harvest", label: "Harvest" },
    ],
  },
  {
    label: "Flock",
    collapsedByDefault: true,
    items: [
      { href: "/admin/chickens/flock", label: "Flocks" },
      { href: "/admin/chickens/eggs", label: "Eggs" },
    ],
  },
  {
    label: "Kit",
    collapsedByDefault: true,
    items: [
      { href: "/admin/equipment", label: "Equipment", owns: ["/admin/equipment/"] },
      { href: "/admin/equipment/roadmap", label: "Equipment roadmap" },
      { href: "/admin/equipment/candidates", label: "Equipment candidates" },
      { href: "/admin/feed", label: "Feed inventory" },
      { href: "/admin/supplies", label: "Supplies" },
    ],
  },
  {
    label: "Business",
    collapsedByDefault: true,
    items: [
      { href: "/admin/business/bookings", label: "Bookings" },
      { href: "/admin/business/clients", label: "Clients" },
      { href: "/admin/business/program", label: "Program roster" },
      { href: "/admin/business/schedule", label: "Day schedule" },
      { href: "/admin/business/forms", label: "Forms" },
      { href: "/admin/business/invoices", label: "Invoices" },
    ],
  },
  {
    label: "Horses",
    collapsedByDefault: true,
    items: [
      { href: "/admin/horses", label: "Horses" },
      { href: "/admin/horses/roadmap", label: "Horse roadmap" },
      { href: "/admin/horses/candidates", label: "Horse candidates" },
    ],
  },
  {
    label: "People & places",
    collapsedByDefault: true,
    items: [
      { href: "/admin/contacts", label: "Contacts" },
      { href: "/admin/pets", label: "Pets" },
      { href: "/admin/housesitter", label: "Housesitter" },
      { href: "/admin/reports", label: "Reports" },
    ],
  },
  {
    label: "Settings",
    collapsedByDefault: true,
    items: [
      { href: "/admin/settings", label: "Settings" },
      { href: "/admin/settings/trash", label: "Trash" },
    ],
  },
];

/**
 * Is this the route we are on?
 *
 * Exact match, plus the prefixes an item declares it owns. A bare `startsWith`
 * would light "Herd" up while somebody is on the breeding page — every cattle
 * route starts with `/admin/cattle` — so ownership is opted into per item and
 * spelled with a trailing slash so `/admin/cattle/breeding` is not swallowed
 * by a prefix it merely happens to share.
 */
export function isCurrent(href: string, pathname: string): boolean {
  return href === pathname;
}

export function isWithin(item: NavItem, pathname: string): boolean {
  if (isCurrent(item.href, pathname)) return true;
  return (item.owns ?? []).some(
    (prefix) =>
      pathname.startsWith(prefix) &&
      // A declared child, not a sibling that shares the prefix and has its own
      // entry in the nav.
      !NAV.some((group) => group.items.some((other) => other.href === pathname)),
  );
}

/** Which group holds this route, so it can be opened on arrival. */
export function groupContaining(pathname: string): string | undefined {
  return NAV.find((group) => group.items.some((item) => isWithin(item, pathname)))?.label;
}
