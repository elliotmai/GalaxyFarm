import {
  addCalendarDays,
  dayKey,
  startOfDay,
  type CalendarEntry,
  type CalendarModule,
} from "@galaxy-farm/core";

/**
 * The three views §6 asks for, as arithmetic (spec §6, §7).
 *
 * Pure and separate from the screen because dates around a month boundary are
 * where calendars go wrong, and a function is testable where a rendered grid
 * is awkward. Everything here works in local time for the reason `dayKey`
 * gives: the day somebody is having in the barn is a local day, and a UTC
 * boundary files every evening under tomorrow for six hours.
 */

export const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** How far ahead the agenda looks, which is roughly "the rest of the month". */
export const AGENDA_DAYS = 30;

export interface CalendarPeriod {
  readonly view: CalendarView;
  /** Local midnight of the first day drawn. */
  readonly from: Date;
  /** Half-open, like every other range in the kernel. */
  readonly to: Date;
  readonly days: number;
  /** The month the grid is *about* — outside days are drawn but dimmed. */
  readonly month: number;
  readonly title: string;
}

/**
 * The span a view covers around a chosen day.
 *
 * A month view draws whole weeks, not the 1st to the 31st: a grid that starts
 * mid-row leaves the last days of July invisible on August's screen, and those
 * are exactly the days somebody scrolling back a week is looking for. So the
 * span runs from the Sunday on or before the 1st to the Saturday on or after
 * the last — and the window handed to `projectEvents` is that same span, so
 * nothing is drawn in a cell the projection was never asked about.
 */
export function calendarPeriod(view: CalendarView, anchor: Date): CalendarPeriod {
  const day = startOfDay(anchor);

  if (view === "week") {
    const from = addCalendarDays(day, -day.getDay());
    return {
      view,
      from,
      to: addCalendarDays(from, 7),
      days: 7,
      month: day.getMonth(),
      title: weekTitle(from),
    };
  }

  if (view === "agenda") {
    return {
      view,
      from: day,
      to: addCalendarDays(day, AGENDA_DAYS),
      days: AGENDA_DAYS,
      month: day.getMonth(),
      title: `${AGENDA_DAYS} days from ${day.toLocaleDateString(undefined, { day: "numeric", month: "long" })}`,
    };
  }

  const first = new Date(day.getFullYear(), day.getMonth(), 1);
  const from = addCalendarDays(first, -first.getDay());
  const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0);
  const last = addCalendarDays(lastDay, 6 - lastDay.getDay());
  // Inclusive of both ends, so the count is the gap plus one.
  const days = Math.round((last.getTime() - from.getTime()) / 86_400_000) + 1;

  return {
    view,
    from,
    to: addCalendarDays(from, days),
    days,
    month: day.getMonth(),
    title: day.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

/** "10 – 16 August 2026", with the month named once when it does not change. */
function weekTitle(from: Date): string {
  const to = addCalendarDays(from, 6);
  const sameMonth = from.getMonth() === to.getMonth();

  const start = from.toLocaleDateString(
    undefined,
    sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" },
  );
  const end = to.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  return `${start} – ${end}`;
}

/**
 * One step forward or back, in the unit the view is showing.
 *
 * A month steps by a month rather than by 28 days, and it steps from the 1st
 * rather than from wherever the anchor happens to sit — stepping from the 31st
 * would land on the 31st of a month that has 30 and silently skip it.
 */
export function stepPeriod(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  if (view === "month") {
    return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
  }
  return addCalendarDays(anchor, direction * (view === "week" ? 7 : AGENDA_DAYS));
}

export const VIEW_LABELS: Readonly<Record<CalendarView, string>> = {
  month: "Month",
  week: "Week",
  agenda: "Agenda",
};

export const MODULE_LABELS: Readonly<Record<CalendarModule, string>> = {
  cattle: "Cattle",
  feed: "Feed",
  poultry: "Poultry",
  garden: "Garden",
  equipment: "Equipment",
  supplies: "Supplies",
  business: "Business",
  chores: "Chores",
  weather: "Weather",
  general: "Manual",
};

/**
 * A colour per module, so a month grid is readable without being read.
 *
 * Only five tones exist and there are ten modules, so several share one. The
 * pairings are by urgency rather than by alphabet: what has a deadline with
 * consequences is `danger`, what is routine is `calm`, and the general tone is
 * kept for the events somebody typed themselves.
 */
export const MODULE_TONES: Readonly<
  Record<CalendarModule, "neutral" | "action" | "calm" | "danger" | "identity">
> = {
  cattle: "identity",
  feed: "action",
  poultry: "action",
  garden: "calm",
  equipment: "action",
  supplies: "action",
  business: "danger",
  chores: "calm",
  weather: "danger",
  general: "neutral",
};

/**
 * The grid's own grouping: every day a row touches, not only the one it opens on.
 *
 * `groupByDay` files a row under its start date, which is what an agenda wants
 * — "what starts when" — and the wrong answer for a grid. A calving window
 * that runs from the 10th to the 25th is a fortnight of watching, and a grid
 * that showed it only on the 10th would leave the 18th looking like a day with
 * nothing happening on it. The same reasoning `projectEvents` already applies
 * to whether a window falls inside a month, applied one level down to whether
 * it falls inside a day.
 *
 * Half-open at the far end, like every range in the kernel: a window closing at
 * midnight on the 25th covers the 24th and not the 25th.
 */
export function groupOverSpan(
  entries: readonly CalendarEntry[],
  from: Date,
  days: number,
): Map<string, CalendarEntry[]> {
  const grid = new Map<string, CalendarEntry[]>();
  for (let offset = 0; offset < days; offset++) {
    grid.set(dayKey(addCalendarDays(from, offset)), []);
  }

  for (const entry of entries) {
    const first = startOfDay(entry.at);
    const last =
      entry.endAt === undefined || entry.endAt <= entry.at
        ? first
        : startOfDay(new Date(entry.endAt.getTime() - 1));

    for (let day = first; day <= last; day = addCalendarDays(day, 1)) {
      grid.get(dayKey(day))?.push(entry);
    }
  }

  return grid;
}

/**
 * The agenda's grouping: what starts on each day, and what is already running.
 *
 * `groupByDay` files a row under its own start date, which for the agenda puts
 * a calving window that opened on the 10th under a heading dated the 10th on a
 * list that begins on the 12th — a day that is not on the screen at all. So a
 * row already under way when the agenda opens is filed under its first day
 * instead, which is the honest reading: it is happening now.
 */
export function groupFromDay(
  entries: readonly CalendarEntry[],
  from: Date,
): Map<string, CalendarEntry[]> {
  const days = new Map<string, CalendarEntry[]>();

  for (const entry of entries) {
    const start = startOfDay(entry.at);
    const key = dayKey(start < from ? from : start);
    const bucket = days.get(key);
    if (bucket === undefined) days.set(key, [entry]);
    else bucket.push(entry);
  }

  return days;
}
