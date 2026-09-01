import {
  feedingOccurrences,
  isShared,
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
 * it cannot name a zone or a feed. Those live in other entities, one in
 * another module, and §4.1 has the composition root be the place they meet.
 * So this is the app's half: the sentence somebody reads on the day sheet.
 *
 * An animal trip needs nothing from here — the kernel titles it by its
 * ration, the plan's own name, because one plan can feed several animals
 * sharing a bowl and a single animal's name would read as feeding only that
 * one.
 *
 * Every species, deliberately. A zone plan feeds whatever is standing in the
 * zone and an animal plan feeds whoever shares the ration — the flock and the
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
  feeds,
  propertyId,
}: {
  readonly zones: readonly Zone[];
  readonly feeds: readonly FeedType[];
  readonly propertyId: Ulid;
}): FeedingChoreText {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));

  return {
    target: (target: Exclude<FeedingTarget, "animal">, targetId: Ulid) => {
      if (target === "zone") return zoneById.get(targetId)?.name ?? "a pen";
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
