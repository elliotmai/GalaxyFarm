"use client";

import {
  displayName,
  feedingOccurrences,
  isShared,
  type Animal,
  type ChoreEntry,
  type FeedingPlan,
  type FeedingPlanLine,
  type FeedingChoreText,
  type FeedingTarget,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import type { FeedType } from "@galaxy-farm/module-feed";

/**
 * Wording a feeding trip (spec §4.1, §5.3).
 *
 * The kernel groups the plans into trips and decides which days they land on;
 * it cannot name any of them. A zone's name, an animal's name and a feed's
 * name live in three entities, one of them in another module, and §4.1 has the
 * composition root be the place those meet. So this is the app's half: the
 * sentence somebody reads on the day sheet.
 *
 * Every species, deliberately. A zone plan feeds whatever is standing in the
 * zone and an animal plan feeds that animal whatever it is — the flock and the
 * barn cats are fed by the same walk out of the house.
 */

const FREQUENCY_SUFFIX: Readonly<Record<string, string>> = {
  once_daily: "",
  twice_daily: " (twice a day)",
  three_times_daily: " (three times a day)",
  every_other_day: " (every other day)",
  weekly: " (weekly)",
};

/**
 * How the amount is said.
 *
 * The unit as typed, because that is the instruction. §5.3 already makes the
 * point that "0.15 bags" and "3 scoops" are the same ration and only one of
 * them is something a person can carry — the plan was written in the vessel
 * somebody actually uses, so the chore repeats it rather than converting.
 */
function amountOf(line: FeedingPlanLine): string {
  const unit = line.amount.unit.replace(/_/g, " ");
  return `${line.amount.amount} ${unit}`;
}

export function feedingChoreText({
  zones,
  animals,
  feeds,
  propertyId,
}: {
  readonly zones: readonly Zone[];
  readonly animals: readonly Animal[];
  readonly feeds: readonly FeedType[];
  readonly propertyId: Ulid;
}): FeedingChoreText {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const animalById = new Map(animals.map((animal) => [animal.id, animal]));
  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));

  return {
    target: (target: FeedingTarget, targetId: Ulid) => {
      if (target === "zone") return zoneById.get(targetId)?.name ?? "a pen";
      if (target === "animal") {
        const animal = animalById.get(targetId);
        return animal === undefined ? "an animal" : displayName(animal);
      }
      // The group plan targets the property, which is the group every animal
      // on the place belongs to — the same resolution `herdDemand` makes.
      return targetId === propertyId ? "everybody" : "the group";
    },
    line: (line: FeedingPlanLine, plan: FeedingPlan) => {
      const feed = feedById.get(line.feedTypeId)?.name ?? "feed";
      // Said out loud only when it is the unusual reading. A shared amount on
      // a pen of four is one tub between them, and putting four out is the
      // mistake this word prevents.
      const shared = isShared(plan) ? ", shared" : "";
      return `${amountOf(line)} ${feed}${FREQUENCY_SUFFIX[line.frequency] ?? ""}${shared}`;
    },
  };
}

/** A day's feeding chores, worded — ready to merge into the sheet. */
export function feedingChoresFor(
  plans: readonly FeedingPlan[],
  text: FeedingChoreText,
  date: Date,
  now: Date,
): ChoreEntry[] {
  return feedingOccurrences(plans, text, date, now);
}
