import { dayKey, daysBetween, startOfDay } from "../value-objects/date-range.js";
import type { Ulid } from "../types/ids.js";
import {
  type FeedingFrequency,
  type FeedingPlan,
  type FeedingPlanLine,
  type FeedingTarget,
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
 * Every species. A zone plan feeds whatever is standing in the zone, an animal
 * plan feeds that animal whatever it is, and a group plan feeds the place —
 * so nothing here filters on species, deliberately. The flock and the barn
 * cats are fed by somebody walking out of the house in the morning too.
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
    case "weekly":
      return startOfDay(anchor).getDay() === startOfDay(date).getDay();
  }
}

/** One line, and the plan it came off — the plan carries the shared/per-head reading. */
export interface TripLine {
  readonly plan: FeedingPlan;
  readonly line: FeedingPlanLine;
}

/** Somewhere to go, once, carrying everything that goes there. */
export interface FeedingTrip {
  readonly target: FeedingTarget;
  readonly targetId: Ulid;
  readonly timeOfDay: TimeOfDay;
  readonly lines: readonly TripLine[];
}

/**
 * The id an occurrence keeps across recomputation.
 *
 * Derived from what the trip *is* rather than from the plans behind it, so
 * adding a second feed to a pen's morning does not renumber the chore somebody
 * is looking at — or worse, orphan the row they already ticked.
 */
export function feedingChoreId(trip: Omit<FeedingTrip, "lines">, date: Date): string {
  return `feeding:${trip.target}:${trip.targetId}:${trip.timeOfDay}:${dayKey(date)}`;
}

/** Every trip a day's active plans add up to, in the order they are walked. */
export function feedingTripsForDay(plans: readonly FeedingPlan[], date: Date): FeedingTrip[] {
  const trips = new Map<string, FeedingTrip & { lines: TripLine[] }>();

  for (const plan of plans) {
    if (!plan.active) continue;

    for (const line of plan.lines) {
      if (!lineOccursOn(line.frequency, plan.createdAt, date)) continue;

      const key = `${plan.target}:${plan.targetId}:${line.timeOfDay}`;
      const existing = trips.get(key);

      if (existing === undefined) {
        trips.set(key, {
          target: plan.target,
          targetId: plan.targetId,
          timeOfDay: line.timeOfDay,
          lines: [{ plan, line }],
        });
        continue;
      }
      existing.lines.push({ plan, line });
    }
  }

  return [...trips.values()].sort(
    (left, right) =>
      FEEDING_TIME_ORDER[left.timeOfDay] - FEEDING_TIME_ORDER[right.timeOfDay] ||
      left.targetId.localeCompare(right.targetId),
  );
}

/**
 * How to say what a trip is and what it carries.
 *
 * Injected rather than worked out here. A zone's name and a feed's name live
 * in other entities — one in another module — and §4.1 has the composition
 * root join them. The kernel groups and schedules; the app words it.
 *
 * An animal trip is the exception, named here rather than injected: it is
 * titled by its *ration* — the plan's own name, which the kernel already
 * holds. One plan can feed several animals eating from the same bowl
 * (`alsoFeeds`), and a title carrying one animal's name would read as feeding
 * only that one. The ration's name covers everybody it feeds, so `target` is
 * only ever asked about a zone or the group.
 */
export interface FeedingChoreText {
  readonly target: (target: Exclude<FeedingTarget, "animal">, targetId: Ulid) => string;
  readonly line: (line: FeedingPlanLine, plan: FeedingPlan) => string;
}

/**
 * What an animal trip is called: the rations it carries.
 *
 * Deduplicated because two lines of one plan are one ration, and joined
 * because two plans landing on one animal's morning are still one walk.
 */
function rationNames(trip: Pick<FeedingTrip, "lines">): string {
  return [...new Set(trip.lines.map(({ plan }) => plan.name))].join(" · ");
}

/** A day's feeding, as chore entries the sheet can merge with everything else. */
export function feedingOccurrences(
  plans: readonly FeedingPlan[],
  text: FeedingChoreText,
  date: Date,
  now: Date,
): ChoreEntry[] {
  return feedingTripsForDay(plans, date).map((trip): ChoreEntry => {
    const dueAt = timeOfDayDeadline(date, trip.timeOfDay);
    const detail = trip.lines.map(({ line, plan }) => text.line(line, plan)).join(" · ");
    const where =
      trip.target === "animal" ? rationNames(trip) : text.target(trip.target, trip.targetId);

    return {
      id: feedingChoreId(trip, date),
      title: `${TIME_OF_DAY_LABELS[trip.timeOfDay]} feed · ${where}`,
      ...(detail === "" ? {} : { detail }),
      dueAt,
      ...(trip.target === "zone" ? { zoneId: trip.targetId } : {}),
      ...(trip.target === "animal" ? { animalId: trip.targetId } : {}),
      carriedOver: false,
      overdue: dueAt < now,
    };
  });
}
