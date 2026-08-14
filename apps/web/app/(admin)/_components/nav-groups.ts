/**
 * The shape of the admin nav (spec §7, §8 v0.9).
 *
 * Five destinations and a utility rail, where there used to be nine collapsing
 * groups holding fifty-five links. The groups were not the problem — the
 * hierarchy was wrong. Breeding, Calving, Health, Weights, Sales and the rest
 * are not siblings of the herd; they are *views of* it, and putting them in the
 * sidebar made every one of them compete with Pastures and Invoices for the
 * same attention.
 *
 * So the sidebar answers "which part of the farm", and the screen answers
 * "which view of it". No route moved and none was merged — §7 is untouched.
 * Everything that was a sidebar row under Cattle is now a tab on the Cattle
 * screen, which is where it always belonged.
 *
 * Split from the component so it can be read as data, and so a test can assert
 * every route in §7 is still reachable from one place or the other.
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

export interface NavDestination extends NavItem {
  /**
   * A glyph, not an icon set. One character each, so the rail costs no
   * dependency and nothing to download — and at five entries a shape is enough
   * to tell them apart before the word is read.
   */
  readonly glyph: string;
  /** The in-page tab strip for this destination. */
  readonly sections: readonly NavItem[];
}

/**
 * The five.
 *
 * `href` is where the destination lands when clicked: the first section, or the
 * one somebody actually wants. Animals lands on cattle because that is the herd
 * this farm runs; the other species are a tab away.
 */
export const NAV: readonly NavDestination[] = [
  {
    href: "/admin",
    label: "Today",
    glyph: "◈",
    sections: [
      { href: "/admin", label: "Dashboard" },
      { href: "/admin/chores", label: "Chores" },
      { href: "/admin/calendar", label: "Calendar" },
      { href: "/admin/map", label: "Property map" },
    ],
  },
  {
    href: "/admin/cattle",
    label: "Animals",
    glyph: "✦",
    sections: [
      { href: "/admin/cattle", label: "Cattle", owns: ["/admin/cattle/"] },
      { href: "/admin/chickens/flock", label: "Flock" },
      { href: "/admin/horses", label: "Horses", owns: ["/admin/horses/"] },
      { href: "/admin/pets", label: "Pets" },
    ],
  },
  {
    href: "/admin/pastures",
    label: "Land",
    glyph: "▢",
    sections: [
      { href: "/admin/pastures", label: "Pastures and water" },
      { href: "/admin/garden/layout", label: "Garden layout" },
      { href: "/admin/garden/plantings", label: "Plantings" },
      { href: "/admin/garden/seeds", label: "Seeds" },
      { href: "/admin/garden/harvest", label: "Harvest" },
    ],
  },
  {
    href: "/admin/equipment",
    label: "Kit",
    glyph: "⚙",
    sections: [
      { href: "/admin/equipment", label: "Equipment", owns: ["/admin/equipment/"] },
      { href: "/admin/feed", label: "Feed inventory" },
      { href: "/admin/supplies", label: "Supplies" },
    ],
  },
  {
    href: "/admin/business/bookings",
    label: "Business",
    glyph: "◇",
    sections: [
      { href: "/admin/business/bookings", label: "Bookings" },
      { href: "/admin/business/clients", label: "Clients" },
      { href: "/admin/business/program", label: "Program roster" },
      { href: "/admin/business/schedule", label: "Day schedule" },
      { href: "/admin/business/forms", label: "Forms" },
      { href: "/admin/business/invoices", label: "Invoices" },
    ],
  },
];

/**
 * Beneath the rule, quieter.
 *
 * Reached deliberately and rarely, which is the difference between these and
 * the five above. Putting Trash and Reports at the same weight as the herd was
 * a large part of what made the sidebar a wall.
 */
export const UTILITY: readonly NavItem[] = [
  { href: "/admin/contacts", label: "Contacts" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/housesitter", label: "Housesitter" },
  { href: "/admin/settings", label: "Settings", owns: ["/admin/settings/"] },
];

/**
 * The second strip, for destinations whose sections have views of their own.
 *
 * This is where the thirteen cattle routes went. Thirteen tabs is a lot, but a
 * tab strip scrolls and a sidebar does not — and every one of them is a view of
 * the herd, so they belong beside each other rather than beside Invoices.
 */
export const SUB_SECTIONS: Readonly<Record<string, readonly NavItem[]>> = {
  "/admin/cattle": [
    { href: "/admin/cattle", label: "Herd", owns: ["/admin/cattle/"] },
    { href: "/admin/cattle/breeding", label: "Breeding" },
    { href: "/admin/cattle/calving", label: "Calving" },
    { href: "/admin/cattle/health", label: "Health" },
    { href: "/admin/cattle/weights", label: "Weights" },
    { href: "/admin/cattle/feed", label: "Feed plans" },
    { href: "/admin/cattle/supplies", label: "Tank and fridge" },
    { href: "/admin/cattle/sales", label: "Sales" },
    { href: "/admin/cattle/ancestors", label: "Ancestors" },
    { href: "/admin/cattle/catalog", label: "Catalog" },
    { href: "/admin/cattle/roadmap", label: "Roadmap" },
    { href: "/admin/cattle/candidates", label: "Candidates" },
    { href: "/admin/cattle/risks", label: "Worth a look" },
  ],
  "/admin/horses": [
    { href: "/admin/horses", label: "Horses" },
    { href: "/admin/horses/herd", label: "Herd" },
    { href: "/admin/horses/pens", label: "Pens" },
    { href: "/admin/horses/feeding", label: "Feeding" },
    { href: "/admin/horses/breeding", label: "Breeding" },
    { href: "/admin/horses/roadmap", label: "Roadmap" },
    { href: "/admin/horses/candidates", label: "Candidates" },
  ],
  "/admin/equipment": [
    { href: "/admin/equipment", label: "Fleet", owns: ["/admin/equipment/"] },
    { href: "/admin/equipment/roadmap", label: "Roadmap" },
    { href: "/admin/equipment/candidates", label: "Candidates" },
  ],
  "/admin/chickens/flock": [
    { href: "/admin/chickens/flock", label: "Flocks" },
    { href: "/admin/chickens/eggs", label: "Eggs" },
  ],
  "/admin/settings": [
    { href: "/admin/settings", label: "Settings" },
    { href: "/admin/settings/trash", label: "Trash" },
  ],
};

/** Every route the nav can reach, wherever it lives. */
export function allNavRoutes(): readonly string[] {
  return [
    ...NAV.flatMap((destination) => destination.sections.map((section) => section.href)),
    ...UTILITY.map((item) => item.href),
    ...Object.values(SUB_SECTIONS).flatMap((items) => items.map((item) => item.href)),
  ];
}

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

/** Every href the nav knows, used to keep `owns` from swallowing a sibling. */
const KNOWN = new Set(allNavRoutes());

export function isWithin(item: NavItem, pathname: string): boolean {
  if (isCurrent(item.href, pathname)) return true;
  return (item.owns ?? []).some(
    (prefix) =>
      pathname.startsWith(prefix) &&
      // A declared child, not a sibling that shares the prefix and has an entry
      // of its own somewhere in the nav.
      !KNOWN.has(pathname),
  );
}

/** Which of the five holds this route, so the rail can mark it. */
export function destinationFor(pathname: string): NavDestination | undefined {
  return NAV.find((destination) =>
    destination.sections.some(
      (section) =>
        isWithin(section, pathname) ||
        (SUB_SECTIONS[section.href] ?? []).some((sub) => isWithin(sub, pathname)),
    ),
  );
}

/** The section within that destination, which owns the second strip. */
export function sectionFor(pathname: string): NavItem | undefined {
  const destination = destinationFor(pathname);
  if (destination === undefined) return undefined;

  return destination.sections.find(
    (section) =>
      isWithin(section, pathname) ||
      (SUB_SECTIONS[section.href] ?? []).some((sub) => isWithin(sub, pathname)),
  );
}
