import type { BaseRecord } from "@galaxy-farm/core";
import {
  TRIP_TRANSPORTS,
  type Trip,
  type TripLeg,
  type TripTransport,
} from "@galaxy-farm/module-housesitting";

/**
 * Reading trips out of Wander (spec §5.10).
 *
 * Wander is the owner's trip planner (`elliotmai/tripplan`), and this is the
 * anti-corruption layer between its wire format and ours: everything below
 * takes `unknown` and hands back either a value this codebase's types describe
 * or nothing at all. Wander's field names are snake_case and its own; `Trip`
 * was shaped to match them field for field, so the mapping is a rename rather
 * than a translation — but it is still a boundary, and §4.5 clause 2 is
 * explicit that data arriving from outside is not trusted for having come from
 * somewhere familiar.
 *
 * **Nothing here converts a time.** A Wander leg carries a wall clock and the
 * IANA zone it is read in, and so does ours — see `TripLeg` for why that is
 * the right storage for a departure. A leg missing either is dropped rather
 * than guessed at: a flight shown at the wrong hour is worse on a housesitter
 * board than a flight not shown at all.
 */

/** What `appTrips` returns, as the picker needs it. */
export interface WanderTripSummary {
  readonly id: string;
  readonly name: string;
  readonly destination?: string | undefined;
  readonly startDate: string;
  readonly endDate: string;
  readonly isCurrent: boolean;
}

export class WanderError extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const IANA = /^[A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function call(
  baseUrl: string,
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url, {
      // The header rather than `?token=`: a query string lands in server logs
      // and anything else that records a URL, and this is a standing
      // credential rather than a one-off.
      headers: { authorization: `Bearer ${token}` },
      // A barn is not the only thing on a slow connection. Without this the
      // admin screen's "Refresh" spins until the platform gives up.
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (cause) {
    throw new WanderError(
      cause instanceof Error && cause.name === "TimeoutError"
        ? "Wander did not answer in time."
        : "Could not reach Wander.",
    );
  }

  if (response.status === 403) {
    throw new WanderError("Wander rejected the token. It may have been disconnected there.");
  }
  if (response.status === 404) {
    throw new WanderError("That trip is no longer on this Wander account.");
  }
  if (!response.ok) {
    throw new WanderError(`Wander answered ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new WanderError("Wander's answer was not readable.");
  }
}

/** Every trip the token's owner is on that has not ended. */
export async function fetchTrips(
  baseUrl: string,
  token: string,
): Promise<readonly WanderTripSummary[]> {
  const body = record(await call(baseUrl, "appTrips", token));
  const rows = body?.trips;
  if (!Array.isArray(rows)) throw new WanderError("Wander did not return a list of trips.");

  return rows.flatMap((raw) => {
    const row = record(raw);
    if (row === undefined) return [];

    const id = str(row.id);
    const startDate = str(row.start_date);
    const endDate = str(row.end_date);
    // A trip without an id cannot be linked, and one without both dates cannot
    // answer the only question the board asks of it.
    if (id === undefined || startDate === undefined || endDate === undefined) return [];
    if (!DAY.test(startDate) || !DAY.test(endDate)) return [];

    const destination = str(row.destination);
    return [
      {
        id,
        name: str(row.name) ?? "Untitled trip",
        ...(destination === undefined ? {} : { destination }),
        startDate,
        endDate,
        isCurrent: row.is_current === true,
      },
    ];
  });
}

function transport(value: unknown): TripTransport {
  const named = str(value);
  // Wander has `subway`, `taxi` and `walk` besides ours. None of them is a
  // reason to drop a leg, and "other" is the honest rendering of a taxi on a
  // board that only ever says how somebody is travelling.
  return named !== undefined && (TRIP_TRANSPORTS as readonly string[]).includes(named)
    ? (named as TripTransport)
    : "other";
}

/** One leg, or nothing if it cannot be trusted to render at the right time. */
export function legFrom(raw: unknown): TripLeg | undefined {
  const row = record(raw);
  if (row === undefined) return undefined;

  const departAt = str(row.depart_at);
  const departTz = str(row.depart_tz);
  // The two that have no sensible default. A wall clock with no zone renders
  // at whatever the reader's zone happens to be, which on a farm kiosk is a
  // flight time quietly shifted by however far the trip went.
  if (departAt === undefined || departTz === undefined) return undefined;
  if (!WALL_CLOCK.test(departAt) || !IANA.test(departTz)) return undefined;

  const arriveAt = str(row.arrive_at);
  const arriveTz = str(row.arrive_tz);
  // An arrival is optional, but a half of one is not: a time with no zone gets
  // dropped rather than rendered in the wrong one.
  const arrival =
    arriveAt !== undefined &&
    arriveTz !== undefined &&
    WALL_CLOCK.test(arriveAt) &&
    IANA.test(arriveTz)
      ? { arriveAt, arriveTz }
      : {};

  const number = str(row.number);
  const notes = str(row.notes);

  return {
    transport: transport(row.transport),
    ...(number === undefined ? {} : { number: number.slice(0, 20) }),
    from: (str(row.from) ?? "—").slice(0, 120),
    to: (str(row.to) ?? "—").slice(0, 120),
    departAt,
    departTz,
    ...arrival,
    ...(notes === undefined ? {} : { notes: notes.slice(0, 500) }),
  };
}

export interface WanderTravel {
  readonly name: string;
  readonly destination?: string | undefined;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly legs: readonly TripLeg[];
  /** Everyone Wander names on a leg, deduped and in the order first seen. */
  readonly travellers: readonly string[];
  /** Legs Wander sent that could not be trusted, so the screen can say so. */
  readonly droppedLegs: number;
}

/**
 * "Elliot", "Elliot and Mai", "Elliot, Mai and Sam".
 *
 * Read aloud off a barn screen, so it is written the way somebody would say
 * it rather than comma-separated. Falls back to the trip's name when Wander
 * names nobody — a leg with no travellers is possible there, and "Orlando and
 * Cincinnati are away" is at least honest about where the farm got it.
 */
export function saidAloud(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function travellerNames(rawLegs: readonly unknown[]): string[] {
  const seen: string[] = [];
  for (const raw of rawLegs) {
    const names = record(raw)?.traveler_names;
    if (!Array.isArray(names)) continue;
    for (const name of names) {
      const trimmed = str(name);
      if (trimmed !== undefined && !seen.includes(trimmed)) seen.push(trimmed);
    }
  }
  return seen;
}

/** Midday local, the same reading `fromDateInput` takes — see its doc comment. */
function dayToDate(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

/** One trip's travel, mapped into the fields a `Trip` record carries. */
export async function fetchTravel(
  baseUrl: string,
  token: string,
  tripId: string,
): Promise<WanderTravel> {
  const body = record(await call(baseUrl, "appTripTravel", token, { trip: tripId }));
  const trip = record(body?.trip);
  if (trip === undefined) throw new WanderError("Wander did not return that trip.");

  const startDate = str(trip.start_date);
  const endDate = str(trip.end_date);
  if (
    startDate === undefined ||
    endDate === undefined ||
    !DAY.test(startDate) ||
    !DAY.test(endDate)
  ) {
    throw new WanderError("That trip has no dates in Wander yet.");
  }

  const rawLegs = Array.isArray(body?.legs) ? body.legs : [];
  const legs = rawLegs.flatMap((raw) => {
    const leg = legFrom(raw);
    return leg === undefined ? [] : [leg];
  });

  const destination = str(trip.destination);
  return {
    name: str(trip.name) ?? "Untitled trip",
    ...(destination === undefined ? {} : { destination }),
    startDate: dayToDate(startDate),
    endDate: dayToDate(endDate),
    legs,
    travellers: travellerNames(rawLegs),
    droppedLegs: rawLegs.length - legs.length,
  };
}

/** The fields a pulled trip writes onto its `Trip` row. */
export function tripFieldsFrom(
  travel: WanderTravel,
  externalId: string,
  /**
   * What the row already said, on a re-pull.
   *
   * `whoIsAway` is the one field Wander cannot express the way a sitter reads
   * it — its profile names are "Elliot Mai", not "Elliot and Mai" — so an
   * owner who has corrected it keeps their wording. Every other field is
   * Wander's and is overwritten, which is exactly what `source: "wander"`
   * warns about in the admin form.
   */
  existingWhoIsAway?: string,
): TripFields {
  const kept = existingWhoIsAway?.trim();

  return {
    name: travel.name,
    ...(travel.destination === undefined ? {} : { destination: travel.destination }),
    startDate: travel.startDate,
    endDate: travel.endDate,
    whoIsAway:
      kept !== undefined && kept !== "" ? kept : (saidAloud(travel.travellers) ?? travel.name),
    legs: travel.legs,
    source: "wander",
    externalId,
  };
}

export type TripFields = Omit<Trip, keyof BaseRecord>;
