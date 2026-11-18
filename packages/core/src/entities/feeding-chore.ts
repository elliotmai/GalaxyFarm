import { dayKey, daysBetween, startOfDay } from "../value-objects/date-range.js";
import type { Ulid } from "../types/ids.js";
import {
  type FeedingFrequency,
  type FeedingPlan,
  type FeedingPlanLine,
  type TimeOfDay,
} from "./feeding-plan.js";
import { TIME_OF_DAY_LABELS, timeOfDayDeadline, type ChoreEntry } from "./task.js";

/**
 * Feeding, as work rather than as a ration (spec §2, §5.1, §5.3).
 *
 * §2 is a non-negotiable: **derive, don't duplicate.** A feeding plan already
 * says what goes out, to whom, how often and at what time of day. Writing a
 * chore template beside it that says "feed the show calves, 6am, daily" is the
 * same fact stored twice, and the two drift the first time a ration changes —
 * with the plan right and the chore list, which is the thing somebody actually
 * works from, quietly wrong.
 *
 * So the day sheet reads the plans. Nothing here is stored until somebody ticks
 * one, which is exactly how chore templates already work: a plan edited today
 * changes tomorrow's sheet without rewriting yesterday's.
 *
 * **One chore per trip, never per line.** §5.1 settles this on the water tanks
 * — "one chore per tank, never per zone: tanks are shared, and one chore per
 * zone would send someone to the same trough more than once", and a chore list
 * that does that "stops being trusted". Feeding is the same shape. Somebody
 * walks to a pen once in the morning carrying everything that pen gets, so a
 * trip is *where you go and when*, and every line from every active plan that
 * lands there merges into it.
 *
 * A trip is keyed by the plan's place: its zone, or its place in words, so the
 * dog and both cats fed in the kitchen at night are one stop. A plan that says
 * nowhere is its own trip. Every trip is titled by its plans' names — what
 * somebody called the ration is how they look for it on the list — and the
 * place rides along as the row's pen, or at the head of the detail. Every
 * species, deliberately —
 * the flock and the gecko are fed by somebody walking round in the morning too.
 */

/** The order somebody works through a day, which is not alphabetical. */
export const FEEDING_TIME_ORDER: Readonly<Record<TimeOfDay, number>> = {
  morning: 0,
  midday: 1,
  evening: 2,
  night: 3,
};

/**
 * Does this line go out on this date?
 *
 * The three daily frequencies are every day. The other two need a day to count
 * from, and a feeding line carries no day-of-week field — so the plan's own
 * `createdAt` is the anchor: a weekly top-up written on a Tuesday recurs on
 * Tuesdays. Arbitrary, but deterministic and explainable, which is what
 * matters when two devices have to reach the same sheet without talking.
 */
export function lineOccursOn(frequency: FeedingFrequency, anchor: Date, date: Date): boolean {
  switch (frequency) {
    case "once_daily":
    case "twice_daily":
    case "three_times_daily":
      return true;
    case "every_other_day":
      return daysBetween(startOfDay(anchor), startOfDay(date)) % 2 === 0;
    case "twice_weekly": {
      // The anchor's weekday and the one half a week on from it.
      const day = startOfDay(date).getDay();
      const first = startOfDay(anchor).getDay();
      return day === first || day === (first + 3) % 7;
    }
    case "weekly":
      return startOfDay(anchor).getDay() === startOfDay(date).getDay();
  }
}

/** One line, and the plan it came off — the plan carries the shared/per-head reading. */
export interface TripLine {
  readonly plan: FeedingPlan;
  readonly line: FeedingPlanLine;
}

/** Where a trip goes: a zone, a place in words, or one plan with no place. */
export type TripPlace =
  | { readonly kind: "zone"; readonly zoneId: Ulid }
  | { readonly kind: "place"; readonly label: string }
  | { readonly kind: "plan"; readonly planId: Ulid };

export interface FeedingTrip {
  readonly place: TripPlace;
  readonly timeOfDay: TimeOfDay;
  readonly lines: readonly TripLine[];
}

export function placeOf(plan: Pick<FeedingPlan, "id" | "placeZoneId" | "placeLabel">): TripPlace {
  if (plan.placeZoneId !== undefined) return { kind: "zone", zoneId: plan.placeZoneId };
  const label = plan.placeLabel?.trim();
  if (label !== undefined && label !== "") return { kind: "place", label };
  return { kind: "plan", planId: plan.id };
}

/** "Kitchen" and "kitchen " are one room, so the key folds case and spaces. */
function placeKey(place: TripPlace): string {
  if (place.kind === "zone") return `zone:${place.zoneId}`;
  if (place.kind === "plan") return `plan:${place.planId}`;
  return `place:${place.label.toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * The id a ticked trip is stored under (`Task.sourceKey`).
 *
 * `feeding:<zone|place|plan>:<ref>:<time>:<day>`. Renaming a place in words
 * changes the key, so a row ticked under the old name stays ticked in the
 * history and today's trip starts unticked — which is honest: it is, in the
 * words on the screen, a different place.
 */
export function feedingChoreId(trip: Omit<FeedingTrip, "lines">, date: Date): string {
  return `feeding:${placeKey(trip.place)}:${trip.timeOfDay}:${dayKey(date)}`;
}

export function feedingTripsForDay(plans: readonly FeedingPlan[], date: Date): FeedingTrip[] {
  const trips = new Map<string, FeedingTrip & { lines: TripLine[] }>();

  for (const plan of plans) {
    if (!plan.active) continue;
    const place = placeOf(plan);

    for (const line of plan.lines) {
      if (!lineOccursOn(line.frequency, plan.createdAt, date)) continue;

      const key = `${placeKey(place)}:${line.timeOfDay}`;
      const existing = trips.get(key);

      if (existing === undefined) {
        trips.set(key, { place, timeOfDay: line.timeOfDay, lines: [{ plan, line }] });
        continue;
      }
      existing.lines.push({ plan, line });
    }
  }

  return [...trips.values()].sort(
    (left, right) =>
      FEEDING_TIME_ORDER[left.timeOfDay] - FEEDING_TIME_ORDER[right.timeOfDay] ||
      placeKey(left.place).localeCompare(placeKey(right.place)),
  );
}

/** How the app words a trip — kept out of the kernel, which has no names. */
export interface FeedingChoreText {
  /** A zone's name. */
  readonly zone: (zoneId: Ulid) => string;
  /** One line, as somebody would read it at the bunk. */
  readonly line: (line: FeedingPlanLine, plan: FeedingPlan) => string;
}

function planNames(trip: Pick<FeedingTrip, "lines">): string {
  return [...new Set(trip.lines.map(({ plan }) => plan.name))].join(" · ");
}

export function feedingOccurrences(
  plans: readonly FeedingPlan[],
  text: FeedingChoreText,
  date: Date,
  now: Date,
): ChoreEntry[] {
  return feedingTripsForDay(plans, date).map((trip): ChoreEntry => {
    const dueAt = timeOfDayDeadline(date, trip.timeOfDay);
    // A zone shows in the row's own "where"; a place in words has no column,
    // so it leads the detail instead.
    const detail = [
      ...(trip.place.kind === "place" ? [trip.place.label] : []),
      ...trip.lines.map(({ line, plan }) => text.line(line, plan)),
    ].join(" · ");
    // A trip that feeds exactly one animal points at it, so the row can open
    // its page; a trip for several, or for a flock, points at nobody.
    const fed = new Set(trip.lines.flatMap(({ plan }) => [...(plan.animalIds ?? [])]));
    const flocks = trip.lines.some(({ plan }) => (plan.flockIds ?? []).length > 0);
    const only = fed.size === 1 && !flocks ? [...fed][0] : undefined;

    return {
      id: feedingChoreId(trip, date),
      title: `${TIME_OF_DAY_LABELS[trip.timeOfDay]} feed · ${planNames(trip)}`,
      ...(detail === "" ? {} : { detail }),
      dueAt,
      ...(trip.place.kind === "zone" ? { zoneId: trip.place.zoneId } : {}),
      ...(only === undefined ? {} : { animalId: only }),
      carriedOver: false,
      overdue: dueAt < now,
    };
  });
}
