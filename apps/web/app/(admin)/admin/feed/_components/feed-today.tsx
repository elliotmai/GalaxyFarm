"use client";

import { EmptyState } from "@galaxy-farm/ui";
import type { ChoreEntry, Ulid } from "@galaxy-farm/core";

import { line } from "./feed-format";

/**
 * Today's feedings, as ticks (Farm › Feed › Today).
 *
 * The same entries the barn kiosk shows — the feeding trips the plans add up
 * to, merged with whatever rows a tick has already written — and the same
 * write behind the tick (`toggleChore`, through the screen). Whoever ticks
 * first, the other sees it, because there is only one row to see.
 */

function timeOf(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function TodayView({
  entries,
  actorId,
  busy,
  onTick,
}: {
  readonly entries: readonly ChoreEntry[];
  readonly actorId: Ulid;
  /** The entry whose tick is being written, so it cannot be tapped twice. */
  readonly busy: string | undefined;
  readonly onTick: (entry: ChoreEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No feeding today"
        detail="Feedings come from the plans. Write one on Plan and it shows here and on the kiosk."
      />
    );
  }

  return (
    <ul
      aria-label="Today's feedings"
      className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
    >
      {entries.map((entry) => {
        const done = entry.completedAt !== undefined;
        const late = !done && entry.overdue;
        // Who, when we know it. Names are not held on this device, so the
        // person ticking is "you" and anybody else (the partner, the kiosk) is
        // the time alone rather than a guess.
        const who = done
          ? line(
              entry.completedBy === actorId ? "Done by you" : "Done",
              timeOf(entry.completedAt as Date),
            )
          : line(entry.detail, late ? `late since ${timeOf(entry.dueAt)}` : timeOf(entry.dueAt));

        return (
          <li key={entry.id} className="flex min-h-[60px] items-center gap-3 py-2 pl-4 pr-2">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={`font-semibold ${done ? "text-muted" : "text-ink"}`}>
                {entry.title}
              </span>
              <span className={`text-sm ${late ? "text-danger" : "text-muted"}`}>{who}</span>
            </span>
            {/* One toggle: a done row un-ticks, as on the kiosk. */}
            <button
              type="button"
              aria-pressed={done}
              aria-label={`Fed: ${entry.title}`}
              disabled={busy === entry.id}
              onClick={() => onTick(entry)}
              className={[
                "inline-flex min-h-target shrink-0 items-center gap-1.5 rounded-density px-3.5 text-sm font-semibold",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:opacity-60",
                done
                  ? "bg-calm/15 text-calm"
                  : "border border-action bg-panel text-action hover:bg-canvas",
              ].join(" ")}
            >
              {done ? (
                <>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 12l5 5 9-10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Done
                </>
              ) : (
                "Fed"
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
