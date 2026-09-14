"use client";

import { awayWindow, type Trip } from "@galaxy-farm/module-housesitting";

/**
 * When they are back, above everything else (spec §5.10).
 *
 * The first question a sitter has is not on the care guide: *how long am I
 * doing this for, and who do I ring before then.* It sits above the tabs
 * rather than inside one because it is the only thing on this board that is
 * true regardless of which panel somebody opened — and because a fact behind a
 * tap is a fact nobody has.
 *
 * Phrased in days rather than dates for the near ones. "Back Sunday" is read
 * correctly by somebody holding a feed bucket; "Back 20/09" is arithmetic.
 */

/** Weekday while that is unambiguous, a date once it is not. */
function returnLabel(endDate: Date, daysUntilReturn: number): string {
  if (daysUntilReturn === 0) return "Back today";
  if (daysUntilReturn === 1) return "Back tomorrow";
  if (daysUntilReturn <= 6) {
    return `Back ${endDate.toLocaleDateString(undefined, { weekday: "long" })}`;
  }
  return `Back ${endDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function departureLabel(startDate: Date, daysUntilDeparture: number): string {
  if (daysUntilDeparture === 1) return "Leaving tomorrow";
  if (daysUntilDeparture <= 6) {
    return `Leaving ${startDate.toLocaleDateString(undefined, { weekday: "long" })}`;
  }
  return `Leaving ${startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function TripBanner({ trip, now }: { readonly trip: Trip; readonly now: Date }) {
  const window = awayWindow(trip, now);
  if (window.status === "over") return null;

  const away = window.status === "away";

  return (
    <section
      // Not a `Callout`: that is the shape reserved for something dangerous,
      // and a fortnight in Orlando is not an alert. Bordered and full width so
      // it still reads as the top of the board.
      className="flex flex-wrap items-baseline justify-between gap-density border border-edge bg-raised p-density"
    >
      <div className="flex min-w-0 flex-col">
        <p className="text-density font-semibold text-ink">
          {trip.whoIsAway} {away ? "are away" : "are about to go away"}
          {trip.destination === undefined ? null : (
            <span className="font-normal text-muted"> · {trip.destination}</span>
          )}
        </p>
        <p className="text-sm text-muted">
          {away
            ? returnLabel(trip.endDate, window.daysUntilReturn)
            : departureLabel(trip.startDate, window.daysUntilDeparture)}
        </p>
      </div>

      {trip.reachableAt === undefined ? null : (
        <p className="flex min-w-0 flex-col items-end">
          <span className="text-sm text-muted">Reach them on</span>
          {/* A kiosk cannot place the call, but a phone opening the same board
              can — and on the wall screen it is still the number to copy. */}
          <a
            className="gf-numeric text-density font-semibold text-action"
            href={`tel:${trip.reachableAt}`}
          >
            {trip.reachableAt}
          </a>
        </p>
      )}
    </section>
  );
}
