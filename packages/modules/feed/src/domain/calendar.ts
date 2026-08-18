import { projectedId, type CalendarEntry, type Ulid } from "@galaxy-farm/core";

import type { FeedType } from "./feed-type.js";
import {
  projectFeed,
  type FeedConsumption,
  type FeedProjection,
  type FeedPurchase,
} from "./inventory.js";

/**
 * What feed puts on the unified calendar (spec §6, §5.3).
 *
 * Two rows per feed type and they are not the same event. The run-out is the
 * day the barn is empty; the reorder point is `runOutDate − reorderLeadDays`,
 * which is the day something has to be *ordered* for that not to happen. §5.3
 * asks for the notification on the second one, and a calendar that showed only
 * the first would be telling somebody about the hole on the morning they fall
 * in it.
 *
 * Both are arithmetic over the purchase and consumption logs — §4.5's derived
 * read model, recomputed rather than stored, so a correction entry counted in
 * the barn on Tuesday moves both dates on Tuesday.
 */

const FEED_TYPES = "feedTypes";

export interface FeedCalendarInput {
  readonly feedTypes: readonly FeedType[];
  readonly purchases: readonly FeedPurchase[];
  readonly consumption: readonly FeedConsumption[];
  /**
   * Daily demand per feed type, summed over the herd.
   *
   * Handed in for the reason `dailyDemand` gives: the sum runs over feeding
   * plans and headcounts that belong to the kernel and to whichever module
   * owns the animals, and §4.1 keeps this module from reaching for either.
   */
  readonly demandByFeedType: ReadonlyMap<Ulid, number>;
}

/** Every feed row, unordered — `projectEvents` sorts and windows them. */
export function feedCalendarEntries(input: FeedCalendarInput, now: Date): CalendarEntry[] {
  return input.feedTypes
    .filter((feed) => feed.active)
    .flatMap((feed) => {
      const projection = projectFeed(
        feed,
        input.purchases,
        input.consumption,
        input.demandByFeedType,
        now,
      );
      return entriesFor(feed, projection);
    });
}

function entriesFor(feed: FeedType, projection: FeedProjection): CalendarEntry[] {
  // Nothing is being fed, so nothing runs out. `runOutDate` returns undefined
  // rather than a date of "never", and a calendar has nowhere to put "never".
  if (projection.runsOutOn === undefined) return [];

  const entries: CalendarEntry[] = [
    {
      id: projectedId("feed_run_out", FEED_TYPES, feed.id),
      kind: "feed_run_out",
      module: "feed",
      title: `${feed.name} runs out`,
      detail: `${round(projection.onHand)} ${feed.unit} on hand, ${round(projection.dailyDemand)} a day`,
      at: projection.runsOutOn,
      allDay: true,
      source: { entity: FEED_TYPES, id: feed.id },
    },
  ];

  if (projection.orderBy !== undefined) {
    entries.push({
      id: projectedId("feed_reorder", FEED_TYPES, feed.id),
      kind: "feed_reorder",
      module: "feed",
      title: `Order ${feed.name}`,
      detail: `${feed.reorderLeadDays} day lead time — runs out ${projection.runsOutOn.toDateString()}`,
      at: projection.orderBy,
      allDay: true,
      source: { entity: FEED_TYPES, id: feed.id },
    });
  }

  return entries;
}

/**
 * A quantity somebody would say out loud.
 *
 * The projection subtracts a fractional day's demand, so on-hand is very
 * rarely a round number — "7.083333333333333 bales" on a calendar row is
 * arithmetic showing through where a count should be.
 */
function round(quantity: number): number {
  return Math.round(quantity * 10) / 10;
}
