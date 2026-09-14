"use client";

import { legsInOrder, type Trip, type TripLeg } from "@galaxy-farm/module-housesitting";

/**
 * The journey, on a barn screen (spec §5.10).
 *
 * Read at a glance and never compared to anything: a sitter wants to know
 * roughly where somebody is today and what time they land on the day they come
 * back. So each leg is one wide row — where it leaves, where it arrives, and
 * the two clock faces — rather than a table somebody has to read across.
 *
 * **Nothing here converts a time.** A leg stores the wall clock as it was
 * printed on the ticket plus the zone it is read in (see `TripLeg`), and this
 * reformats that string rather than parsing it into an instant. "9:21 AM CT"
 * is what the boarding pass says and what the sitter should read; turning it
 * into a `Date` to turn it back into "9:21 AM" would add a zone database and a
 * daylight-saving edge case in exchange for the same six characters.
 */

const TRANSPORT_LABEL: Record<TripLeg["transport"], string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  car: "Drive",
  ferry: "Ferry",
  other: "Travel",
};

/** `2026-09-15T09:21` → `9:21 AM`, by string surgery rather than by parsing. */
function clockFace(wallClock: string): string {
  const time = wallClock.slice(11);
  const hour = Number(time.slice(0, 2));
  const minute = time.slice(3, 5);
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minute} ${suffix}`;
}

/**
 * `America/Chicago` → `CDT`, on the date the leg is travelled.
 *
 * Asked at **noon UTC on that day** rather than at the leg's own time. The
 * stored wall clock carries no offset, so it cannot name an instant on its
 * own; noon is the same side of both daylight-saving changes as any wall clock
 * on that date in every real zone, which is all this needs to pick CST from
 * CDT. A zone the browser does not know falls back to its own name.
 */
function zoneLabel(wallClock: string, zone: string): string {
  const noonUtc = new Date(`${wallClock.slice(0, 10)}T12:00:00Z`);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(noonUtc);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? zone;
  } catch {
    return zone;
  }
}

/** `2026-09-15` → `Tue Sep 15`. Built at local noon, so no date can slip. */
function dayLabel(wallClock: string): string {
  const day = new Date(`${wallClock.slice(0, 10)}T12:00:00`);
  return day.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function Endpoint({
  place,
  wallClock,
  zone,
  align,
}: {
  readonly place: string;
  readonly wallClock: string | undefined;
  readonly zone: string | undefined;
  readonly align: "start" | "end";
}) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col ${align === "end" ? "items-end" : ""}`}>
      <p className="gf-numeric text-density font-semibold text-ink">
        {wallClock === undefined ? "—" : clockFace(wallClock)}
        {wallClock === undefined || zone === undefined ? null : (
          <span className="font-normal text-muted"> {zoneLabel(wallClock, zone)}</span>
        )}
      </p>
      <p className={`text-sm text-muted ${align === "end" ? "text-right" : ""}`}>{place}</p>
    </div>
  );
}

export function TripTravel({ trip }: { readonly trip: Trip }) {
  const legs = legsInOrder(trip);

  if (legs.length === 0) {
    return (
      <p className="text-muted">
        No flights or drives are written down for this trip — only the dates above.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {legs.map((leg, index) => (
        <article
          key={`${leg.departAt}-${leg.from}-${leg.to}-${index}`}
          className="flex flex-col gap-1 border border-edge bg-panel p-density"
        >
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium text-ink">
              {TRANSPORT_LABEL[leg.transport]}
              {leg.number === undefined ? null : (
                <span className="gf-numeric font-semibold"> {leg.number}</span>
              )}
            </h3>
            <span className="text-sm text-muted">{dayLabel(leg.departAt)}</span>
          </header>

          <div className="flex items-start gap-density">
            <Endpoint place={leg.from} wallClock={leg.departAt} zone={leg.departTz} align="start" />
            <span aria-hidden className="pt-1 text-muted">
              →
            </span>
            <Endpoint place={leg.to} wallClock={leg.arriveAt} zone={leg.arriveTz} align="end" />
          </div>

          {leg.notes === undefined ? null : <p className="text-sm text-muted">{leg.notes}</p>}
        </article>
      ))}
    </div>
  );
}
