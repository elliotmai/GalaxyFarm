/**
 * The six kiosk boards (spec §4.4), named once.
 *
 * Settings' "lock to board" dropdown and the kiosk home picker both need this
 * exact list — a board added to one and not the other is a screen Settings can
 * lock to a picker tile that does not exist, or a tile home offers that
 * Settings can never assign. `lockedToBoard` on `kioskDevices` stores the
 * `slug`, not the route, so renaming a route later does not orphan every
 * screen already locked to it.
 */

export type KioskBoardSlug =
  "pen-board" | "calendar" | "chores" | "eggs" | "program-day" | "housesitter";

export interface KioskBoard {
  readonly slug: KioskBoardSlug;
  readonly label: string;
  /** What fits on one line of the board switcher. */
  readonly short: string;
  readonly route: string;
}

export const KIOSK_BOARDS: readonly KioskBoard[] = [
  { slug: "pen-board", label: "Pen Board", short: "Pens", route: "/kiosk/pen-board" },
  { slug: "calendar", label: "Calendar", short: "Calendar", route: "/kiosk/calendar" },
  { slug: "chores", label: "Today's Chores", short: "Chores", route: "/kiosk/chores" },
  { slug: "eggs", label: "Egg Quick-Entry", short: "Eggs", route: "/kiosk/eggs" },
  {
    slug: "program-day",
    label: "Program Day Sheet",
    short: "Program",
    route: "/kiosk/program-day",
  },
  { slug: "housesitter", label: "Housesitter Mode", short: "Sitter", route: "/kiosk/housesitter" },
] as const;

export function kioskBoardFor(slug: string | undefined): KioskBoard | undefined {
  return KIOSK_BOARDS.find((board) => board.slug === slug);
}
