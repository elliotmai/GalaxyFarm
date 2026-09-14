import { z } from "zod";

import { baseRecordSchema, type BaseRecord } from "@galaxy-farm/core";

/**
 * The owners being away (spec §5.10).
 *
 * The care guide answers "how is this place run". This answers the question a
 * sitter asks first and the guide never addresses: *when are you back, and how
 * do I reach you before then.* It is stored rather than derived because nothing
 * else in the farm's records knows a trip is happening.
 *
 * **Shaped to match Wander.** The owner plans travel in a separate app
 * (`elliotmai/tripplan`), and the intent is that a connector fills this record
 * from there rather than anybody retyping a flight time into two apps. So the
 * field names are Wander's field names — `transport`, `number`, `from`, `to`,
 * `departAt`, `departTz` — and a leg that arrives from its `trip_legs`
 * collection maps across by renaming snake_case, nothing more. Entered by hand
 * today, pulled tomorrow, same shape either way; `source` says which happened.
 */

/** What a leg is travelled on. Wander's `transport` values, verbatim. */
export const TRIP_TRANSPORTS = ["flight", "train", "bus", "car", "ferry", "other"] as const;
export type TripTransport = (typeof TRIP_TRANSPORTS)[number];

/**
 * One hop of a journey.
 *
 * **Wall-clock plus a zone, not an instant** — and that is deliberate, because
 * it is the one place this record disagrees with the rest of the codebase.
 *
 * A departure is read off a boarding pass and read aloud to a sitter: "nine
 * twenty-one, Central". That is a clock face in a place, and storing it as an
 * instant would mean converting on the way in and converting back on the way
 * out, twice, to redisplay the number that was typed. Both conversions need a
 * zone database, both can be wrong across a DST boundary, and neither buys
 * anything: nothing compares one leg to another, and nothing counts down to a
 * departure. The trip's own window carries real `Date`s precisely because that
 * *is* compared against today (see `Trip.startDate`).
 *
 * It is also what Wander stores, so a pulled leg survives the trip unchanged.
 */
export interface TripLeg {
  readonly transport: TripTransport;
  /** Flight or service number, as printed — "F9 4018". */
  readonly number?: string | undefined;
  /** Free text, not a validated IATA code: Wander does not validate it either. */
  readonly from: string;
  readonly to: string;
  /** Local wall clock, `YYYY-MM-DDTHH:mm`. */
  readonly departAt: string;
  /** IANA zone the wall clock above is read in — `America/Chicago`. */
  readonly departTz: string;
  readonly arriveAt?: string | undefined;
  readonly arriveTz?: string | undefined;
  readonly notes?: string | undefined;
}

/** `2026-09-15T09:21` — a clock face, with no offset and no seconds. */
const wallClock = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Needs a date and a time, like 2026-09-15T09:21");

/** An IANA zone id. Shape-checked only — the zone table lives in the browser. */
const ianaZone = z
  .string()
  .regex(/^[A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/, "Needs a zone like America/Chicago");

export const tripLegSchema = z.object({
  transport: z.enum(TRIP_TRANSPORTS),
  number: z.string().max(20).optional(),
  from: z.string().min(1, "Where does this leg start?").max(120),
  to: z.string().min(1, "Where does it end?").max(120),
  departAt: wallClock,
  departTz: ianaZone,
  arriveAt: wallClock.optional(),
  arriveTz: ianaZone.optional(),
  notes: z.string().max(500).optional(),
});

export interface Trip extends BaseRecord {
  readonly name: string;
  readonly destination?: string | undefined;
  /**
   * Day granularity, and a real `Date` unlike the legs above: this end is
   * compared against today on every kiosk render to work out whether anybody
   * is away and how long is left.
   */
  readonly startDate: Date;
  readonly endDate: Date;
  /** Who is actually gone, as a sitter would say it — "Elliot and Mai". */
  readonly whoIsAway: string;
  /** The number to try first while they are away, if it is not their usual one. */
  readonly reachableAt?: string | undefined;
  readonly notes?: string | undefined;
  readonly legs: readonly TripLeg[];
  /** `wander` means a connector owns this row and hand edits will be overwritten. */
  readonly source: "manual" | "wander";
  /** Wander's `trips/{id}`, so a pull can find the row it wrote last time. */
  readonly externalId?: string | undefined;
}

export const tripSchema = baseRecordSchema.extend({
  name: z.string().min(1, "Give the trip a name").max(160),
  destination: z.string().max(160).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  whoIsAway: z.string().min(1, "Who is away?").max(160),
  reachableAt: z.string().max(80).optional(),
  notes: z.string().max(5000).optional(),
  legs: z.array(tripLegSchema).default([]),
  source: z.enum(["manual", "wander"]).default("manual"),
  externalId: z.string().max(120).optional(),
}) as unknown as z.ZodType<Trip>;

/**
 * A trip whose end has not passed cannot start after it ends.
 *
 * A domain invariant rather than a Zod refinement, per §4.5 clause 2: Zod
 * checks the shape of one field, and rules that relate two fields to each other
 * live here so the use case can enforce them and a test can state them.
 */
export function tripDatesAreOrdered(trip: Pick<Trip, "startDate" | "endDate">): boolean {
  return trip.endDate.getTime() >= trip.startDate.getTime();
}

/** Midnight-to-midnight day difference, so a return "today" reads as 0 and not -1. */
function wholeDaysBetween(from: Date, to: Date): number {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

export type TripStatus = "upcoming" | "away" | "over";

export interface AwayWindow {
  readonly status: TripStatus;
  /** Days until they are back. 0 means today, negative means already home. */
  readonly daysUntilReturn: number;
  /** Days until they leave, for a trip that has not started. */
  readonly daysUntilDeparture: number;
}

export function awayWindow(trip: Pick<Trip, "startDate" | "endDate">, now: Date): AwayWindow {
  const daysUntilDeparture = wholeDaysBetween(now, trip.startDate);
  const daysUntilReturn = wholeDaysBetween(now, trip.endDate);

  const status: TripStatus =
    daysUntilDeparture > 0 ? "upcoming" : daysUntilReturn < 0 ? "over" : "away";

  return { status, daysUntilReturn, daysUntilDeparture };
}

/**
 * The one trip a sitter's screen should be about.
 *
 * Whoever is away right now; failing that, whoever leaves soonest. A farm with
 * three trips on the books has one that matters at any given moment, and asking
 * a sitter to pick from a list is asking them to know which.
 */
export function currentTrip(trips: readonly Trip[], now: Date): Trip | undefined {
  const live = trips.filter((trip) => trip.deletedAt === undefined);

  const away = live
    .filter((trip) => awayWindow(trip, now).status === "away")
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
  if (away[0] !== undefined) return away[0];

  return live
    .filter((trip) => awayWindow(trip, now).status === "upcoming")
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
}

/** Legs in the order they are travelled. Wall clocks sort lexically by design. */
export function legsInOrder(trip: Pick<Trip, "legs">): readonly TripLeg[] {
  return [...trip.legs].sort((a, b) => a.departAt.localeCompare(b.departAt));
}
