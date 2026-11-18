import {
  feedingOccurrences,
  isTotal,
  type Animal,
  type ChoreEntry,
  type FeedingPlan,
  type FeedingPlanLine,
  type FeedingChoreText,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import type { FeedType } from "@galaxy-farm/module-feed";

import { amountWords, nameList, receptacleWords } from "@/lib/feed-lines";

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
  twice_weekly: " (twice a week)",
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

export function feedingChoreText({
  zones,
  feeds,
  animals = [],
}: {
  readonly zones: readonly Zone[];
  readonly feeds: readonly FeedType[];
  /** For naming who a line is for when a trip feeds more than one plan. */
  readonly animals?: readonly Pick<Animal, "id" | "name" | "tagNumber">[];
  /** Accepted and ignored: a plan names its animals, not the place. */
  readonly propertyId?: Ulid;
}): FeedingChoreText {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
  const nameOf = new Map(
    animals.map((animal) => [animal.id, animal.name ?? animal.tagNumber ?? "one"]),
  );

  return {
    zone: (zoneId: Ulid) => zoneById.get(zoneId)?.name ?? "a pen",
    line: (line: FeedingPlanLine, plan: FeedingPlan) => {
      const feed = feedById.get(line.feedTypeId)?.name ?? "feed";
      const amount = amountWords(line.amount.amount, line.amount.unit);
      // Who it is for, when that is a short list: "for Max", "for Tabby and
      // Tom, together". A herd's line is just the amount — the heading names
      // the pen, and a list of thirty names is not an instruction.
      const ids = plan.animalIds ?? [];
      const names = ids.length > 0 && ids.length <= 3 ? ids.map((id) => nameOf.get(id)) : [];
      const who =
        names.every((name) => name !== undefined) && names.length > 0
          ? ` for ${nameList(names as string[])}`
          : "";
      const together =
        isTotal(plan) && ids.length + (plan.flockIds ?? []).length > 1
          ? ", together"
          : ids.length > 1 || (plan.flockIds ?? []).length > 0
            ? " each"
            : "";
      return `${amount} ${feed}${who}${together}${receptacleWords(line.receptacle)}${
        FREQUENCY_SUFFIX[line.frequency] ?? ""
      }`;
    },
  };
}

export function feedingChoresFor(
  plans: readonly FeedingPlan[],
  text: FeedingChoreText,
  date: Date,
  now: Date,
): ChoreEntry[] {
  return feedingOccurrences(plans, text, date, now);
}
