"use client";

import { EmptyState, Pill, RecordCard } from "@galaxy-farm/ui";
import type { CalendarEntry } from "@galaxy-farm/core";

import { MODULE_LABELS, MODULE_TONES } from "@/lib/calendar-view";

/**
 * A run of calendar rows, read in full (spec §6).
 *
 * The agenda view and the day panel under the grid are the same list, so they
 * are the same component. What a row has to carry is where it came from: a
 * projected row is derived from a record somewhere else, and one that cannot
 * say which module produced it is a row nobody can act on.
 */

export function EntryList({
  entries,
  emptyTitle,
  emptyDetail,
  onEdit,
  onDelete,
}: {
  readonly entries: readonly CalendarEntry[];
  readonly emptyTitle: string;
  readonly emptyDetail: string;
  /** Manual rows only — a projected row has no copy of its own to edit. */
  readonly onEdit?: ((entry: CalendarEntry) => void) | undefined;
  readonly onDelete?: ((entry: CalendarEntry) => void) | undefined;
}) {
  if (entries.length === 0) {
    return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  }

  return (
    <div className="flex flex-col gap-density">
      {entries.map((entry) => (
        <RecordCard
          key={entry.id}
          tone={MODULE_TONES[entry.module]}
          title={entry.title}
          subtitle={entry.detail}
          meta={
            <>
              <Pill tone={MODULE_TONES[entry.module]}>{MODULE_LABELS[entry.module]}</Pill>
              <Pill>{timeLabel(entry)}</Pill>
              {entry.kind === "manual" ? null : (
                // §4.5: the projected half is a read model. Saying so on the
                // row is what stops somebody hunting for an edit button that
                // would be a second source of truth if it existed.
                <Pill tone="neutral">Derived</Pill>
              )}
            </>
          }
          actions={
            entry.kind === "manual" && onEdit !== undefined && onDelete !== undefined ? (
              <>
                <button
                  type="button"
                  className="min-h-target cursor-pointer px-2 text-density text-action underline-offset-2 hover:underline"
                  onClick={() => onEdit(entry)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="min-h-target cursor-pointer px-2 text-density text-action underline-offset-2 hover:underline"
                  onClick={() => onDelete(entry)}
                >
                  Delete
                </button>
              </>
            ) : undefined
          }
        />
      ))}
    </div>
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
