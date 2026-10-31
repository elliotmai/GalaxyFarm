"use client";

import { dayKey, type CalendarEntry } from "@galaxy-farm/core";
import { Pill } from "@galaxy-farm/ui";

import { addCalendarDays } from "@galaxy-farm/core";

import { MODULE_TONES, type CalendarPeriod } from "@/lib/calendar-view";

/**
 * The month and week grids (spec §6, "month/week/agenda views").
 *
 * One component for both, because a week *is* a month grid one row tall — and
 * because two components would be two places to get the day-boundary
 * arithmetic wrong.
 *
 * A cell shows at most three rows and then a count. The alternative is a cell
 * that grows to fit, which on a busy week makes every other row on the grid a
 * different height and the whole month unreadable — and the day panel below
 * the grid is one tap away with the rest.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MAX_ROWS = 3;

export function CalendarGrid({
  period,
  byDay,
  today,
  selected,
  onSelect,
}: {
  readonly period: CalendarPeriod;
  readonly byDay: ReadonlyMap<string, CalendarEntry[]>;
  readonly today: Date;
  readonly selected: string | undefined;
  readonly onSelect: (day: string) => void;
}) {
  const days = Array.from({ length: period.days }, (_, offset) =>
    addCalendarDays(period.from, offset),
  );
  const todayKey = dayKey(today);

  return (
    <div className="overflow-hidden rounded-density border border-rule bg-panel">
      <div className="grid grid-cols-7 border-b border-rule">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} className="p-2 text-center text-sm font-medium text-muted">
            {weekday}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day);
          const entries = byDay.get(key) ?? [];
          // Days from the month either side are drawn rather than left blank:
          // the last days of July are what somebody looking at August's first
          // week is usually looking for.
          const outside = period.view === "month" && day.getMonth() !== period.month;

          return (
            <button
              key={key}
              type="button"
              aria-current={key === todayKey ? "date" : undefined}
              aria-pressed={key === selected}
              onClick={() => onSelect(key)}
              className={[
                "flex min-h-14 min-w-0 cursor-pointer flex-col items-stretch gap-1 border-b border-r border-rule p-1.5 text-left sm:min-h-24",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-action",
                outside ? "bg-canvas" : "",
                key === selected ? "ring-2 ring-inset ring-action" : "hover:bg-canvas",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span
                className={[
                  "text-sm",
                  key === todayKey ? "font-semibold text-action" : "",
                  outside ? "text-muted" : "text-ink",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {day.getDate()}
                <span className="sr-only">
                  {" "}
                  {day.toLocaleDateString(undefined, { month: "long" })} — {entries.length} entries
                </span>
              </span>

              {/* A phone cell is 48px wide: titles there are three ellipses,
                  so it gets a count and the day panel gets the words. */}
              {entries.length === 0 ? null : (
                <span
                  aria-hidden="true"
                  className="gf-numeric text-xs font-semibold text-action sm:hidden"
                >
                  {entries.length}
                </span>
              )}

              {entries.slice(0, MAX_ROWS).map((entry) => (
                <Pill
                  key={entry.id}
                  tone={MODULE_TONES[entry.module]}
                  className="hidden truncate text-left text-xs sm:block"
                >
                  {entry.title}
                </Pill>
              ))}

              {entries.length > MAX_ROWS ? (
                <span className="hidden px-1 text-xs text-muted sm:block">
                  {entries.length - MAX_ROWS} more
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
