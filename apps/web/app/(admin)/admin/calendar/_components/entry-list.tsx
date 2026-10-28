"use client";

import { EmptyState, Pill } from "@galaxy-farm/ui";
import type { CalendarEntry } from "@galaxy-farm/core";

import { MODULE_LABELS, MODULE_TONES } from "@/lib/calendar-view";

/**
 * A run of calendar rows, read in full (spec §6).
 *
 * The agenda view and the day panel under the grid are the same list, so they
 * are the same component. What a row has to carry is where it came from: a
 * projected row is derived from a record somewhere else, and one that cannot
 * say which module produced it is a row nobody can act on — so the module is
 * the row's one chip, and "Derived" is said in its line of facts.
 *
 * Only a manual row has an edit button, and delete lives in the panel it
 * opens: two text links on every row was most of the row.
 */

export function EntryList({
  entries,
  emptyTitle,
  emptyDetail,
  onEdit,
}: {
  readonly entries: readonly CalendarEntry[];
  readonly emptyTitle: string;
  readonly emptyDetail?: string | undefined;
  /** Manual rows only — a projected row has no copy of its own to edit. */
  readonly onEdit?: ((entry: CalendarEntry) => void) | undefined;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        {...(emptyDetail === undefined ? {} : { detail: emptyDetail })}
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
      {entries.map((entry) => (
        <li key={entry.id} className="flex min-h-[60px] items-center gap-3 py-2 pl-4 pr-2">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-semibold text-ink">{entry.title}</span>
            <span className="truncate text-sm text-muted">
              {timeLabel(entry)}
              {entry.kind === "manual" ? null : (
                <>
                  {" · "}
                  {/*
                    §4.5: the projected half is a read model. Saying so on the
                    row is what stops somebody hunting for an edit button that
                    would be a second source of truth if it existed.
                  */}
                  <span>Derived</span>
                </>
              )}
              {entry.detail === undefined || entry.detail === "" ? null : ` · ${entry.detail}`}
            </span>
          </span>
          <Pill tone={MODULE_TONES[entry.module]}>{MODULE_LABELS[entry.module]}</Pill>
          {entry.kind === "manual" && onEdit !== undefined ? (
            <button
              type="button"
              aria-label="Edit"
              title={`Edit ${entry.title}`}
              onClick={() => onEdit(entry)}
              className="inline-flex min-h-target min-w-target shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 20h4L19 9l-4-4L4 16z" />
                <path d="M13.5 6.5l4 4" />
              </svg>
            </button>
          ) : (
            // Holds the column, so manual and derived rows line their chips up.
            <span aria-hidden="true" className="min-w-target shrink-0" />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * When it happens, in the fewest words that are still true.
 *
 * A window says both ends, because "10 November" for a calving window that
 * runs to the 25th is the kind of half-truth that has somebody stop watching
 * on the 11th.
 */
function timeLabel(entry: CalendarEntry): string {
  const day = (date: Date) =>
    date.toLocaleDateString(undefined, { day: "numeric", month: "short" });

  if (entry.endAt !== undefined && entry.endAt > entry.at) {
    return `${day(entry.at)} – ${day(entry.endAt)}`;
  }
  if (entry.allDay) return day(entry.at);

  return `${day(entry.at)}, ${entry.at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
