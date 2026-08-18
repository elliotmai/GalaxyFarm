import {
  feedingsPerDay,
  type FeedingFrequency,
  type FeedingPlanLine,
  type Unit,
} from "@galaxy-farm/core";
import {
  describeGrain,
  isGrainMeasure,
  measureToPounds,
  type FeedType,
} from "@galaxy-farm/module-feed";

/**
 * The arithmetic behind a feeding plan's lines (spec §5.3).
 *
 * Out of the component because it is the part that can be wrong in a way that
 * matters. A ration typed in the wrong unit is a week of underfeeding that
 * nothing on any screen complains about, and a plan that feeds one feed in two
 * different units makes `dailyDemandOf` throw on whatever screen reads it back
 * — neither of which is a thing to find out about in a browser.
 */

export interface PlanLineDraft {
  readonly feedId: string;
  readonly amount: string;
  readonly unit: Unit;
  readonly frequency: FeedingFrequency;
}

/**
 * The feed two lines disagree about the units of, if there is one.
 *
 * `dailyDemandOf` refuses to add bags to scoops — quite rightly, a plan whose
 * total has no meaning is a plan with a bug in it — but it refuses by throwing,
 * and the throw happens on the screen that reads the plan rather than the one
 * that wrote it. Caught here, it is a sentence under the form instead.
 */
export function mixedUnitFeed(lines: readonly PlanLineDraft[]): string | undefined {
  for (const line of lines) {
    if (line.feedId === "") continue;
    const clash = lines.find((other) => other.feedId === line.feedId && other.unit !== line.unit);
    if (clash !== undefined) return line.feedId;
  }
  return undefined;
}

/**
 * One line said the way somebody feeding would say it.
 *
 * Shown while it is being typed. "0.15 bags" and "3 scoops" are the same
 * ration and only one of them is an instruction, so both the per-feeding
 * amount and the daily total are spelled out in vessels wherever the unit is
 * one. It doubles as the check on a slip: an amount entered in the wrong unit
 * reads as an absurd figure here, before it becomes a week of underfeeding.
 *
 * Empty when there is nothing to say — no amount yet, or a unit whose weight
 * nobody has given, because a made-up figure is worse than a blank.
 */
export function describeLine(
  line: PlanLineDraft,
  feed: Pick<FeedType, "unit" | "estWeightLbPerUnit"> | undefined,
): string {
  const amount = Number(line.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "";

  // The feed's own weight applies only to the unit it is catalogued in. A
  // 1,200 lb round bale says nothing about what a scoop of it weighs.
  const perUnit =
    feed !== undefined && feed.unit === line.unit ? feed.estWeightLbPerUnit : undefined;
  const pounds = measureToPounds(amount, line.unit, perUnit);
  if (pounds === undefined) return "";

  const daily = pounds * feedingsPerDay(line.frequency);
  const round = (value: number): number => Number(value.toFixed(1));

  if (!isGrainMeasure(line.unit)) {
    return `${round(pounds)} lb each time — ${round(daily)} lb a day.`;
  }

  return `${describeGrain(pounds)} each time — ${describeGrain(daily)} a day, about ${round(daily)} lb.`;
}

const FREQUENCY_WORDS: Readonly<Record<FeedingPlanLine["frequency"], string>> = {
  once_daily: "once a day",
  twice_daily: "twice a day",
  three_times_daily: "three times a day",
  every_other_day: "every other day",
  weekly: "once a week",
};

/** "Smokey and Boots"; "Smokey, Boots and Tig". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] as string}`;
}

/**
 * One saved line, in the words somebody would say it.
 *
 * "1 scoop of Purina Pro Plan, twice a day, morning" rather than a row of
 * fields. The pet card, the cattle feeding section of the housesitter guide
 * and the plan list all want a sentence, and building it three times is how
 * they end up disagreeing about the amount.
 *
 * `sharedBetween` is what stops a helper doubling the food. Two barn cats on
 * one bowl read the same line on both their cards, and "half a pound, twice a
 * day" on each of two cards is a pound a day going into the bowl instead of
 * half — so when the amount is a combined one the sentence says whose it is.
 */
export function describePlanLine(
  line: FeedingPlanLine,
  feeds: readonly Pick<FeedType, "id" | "name">[],
  sharedBetween: readonly string[] = [],
): string {
  const feed = feeds.find((held) => held.id === line.feedTypeId)?.name ?? "feed";
  const unit = line.amount.unit.replace(/_/g, " ");
  const plural = line.amount.amount === 1 ? unit : `${unit}s`;
  const between = sharedBetween.length > 1 ? ` between ${nameList(sharedBetween)}` : "";

  return `${line.amount.amount} ${plural} of ${feed}${between}, ${FREQUENCY_WORDS[line.frequency]}, ${line.timeOfDay}${
    line.notes === undefined ? "" : ` — ${line.notes}`
  }`;
}
