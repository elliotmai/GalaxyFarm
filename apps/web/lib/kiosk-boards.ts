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

export interface KioskBoard {
  readonly slug: string;
  readonly label: string;
  readonly route: string;
}

export const KIOSK_BOARDS: readonly KioskBoard[] = [
  { slug: "pen-board", label: "Pen Board", route: "/kiosk/pen-board" },
  { slug: "calendar", label: "Calendar", route: "/kiosk/calendar" },
  { slug: "chores", label: "Today's Chores", route: "/kiosk/chores" },
  { slug: "eggs", label: "Egg Quick-Entry", route: "/kiosk/eggs" },
  { slug: "program-day", label: "Program Day Sheet", route: "/kiosk/program-day" },
  { slug: "housesitter", label: "Housesitter Mode", route: "/kiosk/housesitter" },
] as const;

export function kioskBoardFor(slug: string | undefined): KioskBoard | undefined {
  return KIOSK_BOARDS.find((board) => board.slug === slug);
}
