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
  /** The landing page draws no strip; see `NAV`. */
  readonly quietLanding?: boolean;
}

/**
 * The four places, plus Log (spec §7, §8 v1.7).
 *
 * Shaped by how the farm is actually run: two people doing everything, half
 * on a phone and half at a desk, with chores and feeding the only weekly job
 * and most of that ticked on the barn kiosks. So the phone opens on Today; an
 * animal is one tap away under Animals, every species in one list; the land,
 * the feed and the kit are Farm; and everything seasonal or set-up-once is
 * under More. Logging is not a place — it is the button between them, see
 * `LOG_HREF`.
 *
 * `href` is where the destination lands. `quietLanding` means the landing page
 * draws no section strip of its own: Animals has species chips on the page,
 * and a strip above them saying the same five words was the clutter this
 * restructure exists to remove.
 */
export const NAV: readonly NavDestination[] = [
  {
    href: "/admin",
    label: "Today",
    glyph: "◈",
    sections: [{ href: "/admin", label: "Today" }],
  },
  {
    href: "/admin/animals",
    label: "Animals",
    glyph: "✦",
    quietLanding: true,
    sections: [
      { href: "/admin/animals", label: "All" },
      { href: "/admin/cattle", label: "Cattle", owns: ["/admin/cattle/"] },
      { href: "/admin/horses", label: "Horses", owns: ["/admin/horses/"] },
      // `owns`: a flock's own page (`/admin/chickens/flock/<name>`) sits in
      // Chickens, and as a record page draws no strips (see `SectionStrip`).
      { href: "/admin/chickens/flock", label: "Chickens", owns: ["/admin/chickens/flock/"] },
      // Dogs owns the pets' own pages (`/admin/pets/<name>`), cats included:
      // they share one address space, and a record page draws no strip, so
      // which of the two lights is the only difference it makes.
      { href: "/admin/pets/dogs", label: "Dogs", owns: ["/admin/pets/"] },
      { href: "/admin/pets/cats", label: "Cats" },
    ],
  },
  {
    href: "/admin/feed",
    label: "Farm",
    glyph: "▢",
    sections: [
      { href: "/admin/feed", label: "Feed" },
      { href: "/admin/pastures", label: "Pastures and water" },
      { href: "/admin/map", label: "Map" },
      { href: "/admin/supplies", label: "Supplies" },
      { href: "/admin/equipment", label: "Equipment", owns: ["/admin/equipment/"] },
      { href: "/admin/garden/plantings", label: "Garden" },
    ],
  },
  {
    href: "/admin/more",
    label: "More",
    glyph: "⋯",
    sections: [{ href: "/admin/more", label: "More" }],
  },
];

/** The button between the places: log anything, for one animal or several. */
export const LOG_HREF = "/admin/log";

/**
 * What More holds, in the groups the More page draws.
 *
 * Seasonal work done at a desk, the people the farm deals with, and the
 * things set up once. All of it reached deliberately, none of it daily —
 * which is the difference between these and the four above.
 */
export interface MoreGroup {
  readonly label: string;
  readonly items: readonly (NavItem & { readonly hint: string })[];
}

export const MORE: readonly MoreGroup[] = [
  {
    label: "Seasonal · best at a desk",
    items: [
      {
        href: "/admin/breeding",
        label: "Breeding",
        hint: "Pairings, catalog, ancestors and the semen tank",
      },
      { href: "/admin/reports", label: "Reports", hint: "Costs, sales and the year in numbers" },
      { href: "/admin/calendar", label: "Calendar", hint: "Every dated thing on the place" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/admin/contacts", label: "Contacts", hint: "Vet, AI tech, feed store, hauler" },
      {
        href: "/admin/housesitter",
        label: "Housesitter",
        hint: "The guide, trips and the sitter link",
      },
      { href: "/admin/business/bookings", label: "Bookings", hint: "Show-calf boarding requests" },
      { href: "/admin/business/clients", label: "Clients", hint: "Boarding customers" },
      { href: "/admin/business/program", label: "Program roster", hint: "Who is in the program" },
      { href: "/admin/business/schedule", label: "Day schedule", hint: "The boarding day" },
      { href: "/admin/business/forms", label: "Forms", hint: "Agreements and releases" },
      { href: "/admin/business/invoices", label: "Invoices", hint: "What customers owe" },
    ],
  },
  {
    label: "Set-up",
    items: [
      {
        href: "/admin/chores",
        label: "Chores and feeding",
        hint: "What appears on Today and the kiosk",
      },
      {
        href: "/admin/settings",
        label: "Settings",
        hint: "Farm, people, kiosks, appearance",
        owns: ["/admin/settings/"],
      },
    ],
  },
];

/** Every More item, flat — what used to be the utility rail, and the business pages. */
export const UTILITY: readonly NavItem[] = MORE.flatMap((group) => group.items);

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
  // Each species' page leads its own strip, and its tools follow (decision 44).
  "/admin/horses": [
    { href: "/admin/horses", label: "Horses" },
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
  "/admin/garden/plantings": [
    { href: "/admin/garden/plantings", label: "Plantings" },
    { href: "/admin/garden/layout", label: "Layout" },
    { href: "/admin/garden/seeds", label: "Seeds" },
    { href: "/admin/garden/harvest", label: "Harvest" },
  ],
  "/admin/chickens/flock": [
    { href: "/admin/chickens/flock", label: "Chickens" },
    { href: "/admin/chickens/eggs", label: "Eggs" },
    { href: "/admin/chickens/headcount", label: "Headcount" },
  ],
  // Vet, medicine and feeding are kept for every pet together, so both
  // species' strips lead to the one Pet care page.
  "/admin/pets/dogs": [
    { href: "/admin/pets/dogs", label: "Dogs" },
    { href: "/admin/pets", label: "Pet care" },
  ],
  "/admin/pets/cats": [
    { href: "/admin/pets/cats", label: "Cats" },
    { href: "/admin/pets", label: "Pet care" },
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
    LOG_HREF,
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
  const found = NAV.find((destination) =>
    destination.sections.some(
      (section) =>
        isWithin(section, pathname) ||
        (SUB_SECTIONS[section.href] ?? []).some((sub) => isWithin(sub, pathname)),
    ),
  );
  if (found !== undefined) return found;

  // Anything listed on the More page lights More, so a page reached from it
  // never leaves the nav with nothing marked.
  const fromMore =
    UTILITY.some((item) => isWithin(item, pathname)) ||
    UTILITY.some((item) => (SUB_SECTIONS[item.href] ?? []).some((sub) => isWithin(sub, pathname)));
  return fromMore ? NAV.find((destination) => destination.href === "/admin/more") : undefined;
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

/** A handful of a section's views that belong together, under one name. */
export interface ViewGroup {
  readonly label: string;
  readonly views: readonly NavItem[];
}

const cattleView = (href: string): NavItem => {
  const found = (SUB_SECTIONS["/admin/cattle"] ?? []).find((view) => view.href === href);
  if (found === undefined) throw new Error(`${href} is not a cattle view`);
  return found;
};

/**
 * Thirteen views of one herd, as four questions (spec §8 v0.9).
 *
 * A strip of thirteen tabs scrolls, which kept the sidebar short, but the eye
 * still has to read all thirteen to find one. Grouped, the first strip is four
 * words — what the herd is, what it is making, how it is, what it is worth —
 * and the second holds only the views of the one chosen.
 *
 * Every view here is one of `SUB_SECTIONS`, so reachability is unchanged and
 * the test that guards it still reads the flat list. A view in no group would
 * be reachable by URL and by search but missing from the strip, which
 * `nav-reachability.test.ts` checks for.
 */
export const VIEW_GROUPS: Readonly<Record<string, readonly ViewGroup[]>> = {
  "/admin/cattle": [
    {
      label: "Herd",
      views: ["/admin/cattle", "/admin/cattle/weights", "/admin/cattle/feed"].map(cattleView),
    },
    {
      label: "Breeding",
      views: [
        "/admin/cattle/breeding",
        "/admin/cattle/calving",
        "/admin/cattle/supplies",
        "/admin/cattle/ancestors",
        "/admin/cattle/catalog",
        "/admin/cattle/candidates",
      ].map(cattleView),
    },
    {
      label: "Health",
      views: ["/admin/cattle/health", "/admin/cattle/risks"].map(cattleView),
    },
    {
      label: "Sales",
      views: ["/admin/cattle/sales", "/admin/cattle/roadmap"].map(cattleView),
    },
  ],
};
