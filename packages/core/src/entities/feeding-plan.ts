import { z } from "zod";

import { quantitySchema, type Quantity } from "../value-objects/quantity.js";
import { ulidSchema, type Ulid } from "../types/ids.js";
import { baseRecordSchema, type BaseRecord } from "./record.js";

/**
 * What something gets fed (spec §5.1).
 *
 * Targets are animal, zone, or group, and the spec is explicit about why:
 * "per-cow custom mixtures are just an animal-targeted plan that
 * overrides/extends the group plan". One entity, three scopes — not three
 * entities — so the resolution rule is written once and the feed module's
 * demand calculation (§5.3) sums over a single table.
 */

export const FEEDING_TARGETS = ["animal", "zone", "group"] as const;
export type FeedingTarget = (typeof FEEDING_TARGETS)[number];

/**
 * How often a line is fed.
 *
 * Stored as a named frequency rather than a number of feedings per day,
 * because "twice daily" is what somebody says at the bunk and `2` is what the
 * projection needs. `feedingsPerDay` converts; nothing else has to know.
 */
export const FEEDING_FREQUENCIES = [
  "once_daily",
  "twice_daily",
  "three_times_daily",
  "every_other_day",
  "weekly",
] as const;
export type FeedingFrequency = (typeof FEEDING_FREQUENCIES)[number];

export const TIMES_OF_DAY = ["morning", "midday", "evening", "night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export interface FeedingPlanLine {
  readonly feedTypeId: Ulid;
  readonly amount: Quantity;
  readonly frequency: FeedingFrequency;
  readonly timeOfDay: TimeOfDay;
  readonly notes?: string | undefined;
}

/**
 * Whether the amounts are what each animal gets, or what they get between them.
 *
 * Everything written before this field existed meant `per_head`, which is why
 * that is the default and why it has to stay the default: "40 lb of hay" on a
 * pen of four is forty pounds each, and reading it as ten would empty a barn
 * in a quarter of the time nobody was expecting.
 *
 * `shared` is the other real case, and it is not rare. Two barn cats eat out
 * of one bowl; a mineral tub goes in a pen and lasts the pen a fortnight. Both
 * are a single amount that does not multiply by headcount, and writing them
 * per-head is the same error in the opposite direction — a run-out date that
 * arrives long after the barn is empty.
 */
export const PORTIONS = ["per_head", "shared"] as const;
export type Portion = (typeof PORTIONS)[number];

export interface FeedingPlan extends BaseRecord {
  readonly name: string;
  readonly target: FeedingTarget;
  /** The animal, zone, or group this plan feeds. */
  readonly targetId: Ulid;
  /**
   * Other animals eating from the same bowl.
   *
   * For an animal-targeted plan only — a zone or group plan already names its
   * population. An array rather than a Group entity because that is what §4.2
   * can sync: a field-level patch has no representation for a join table, and
   * two barn cats do not need a table to be two barn cats.
   */
  readonly alsoFeeds: readonly Ulid[];
  readonly lines: readonly FeedingPlanLine[];
  /** Is each line what one animal gets, or what they all get between them? */
  readonly portion: Portion;
  /** Turned off out of season without losing the plan. */
  readonly active: boolean;
  readonly specialNotes?: string | undefined;
}

export const planLineSchema = z.object({
  feedTypeId: ulidSchema,
  amount: quantitySchema,
  frequency: z.enum(FEEDING_FREQUENCIES),
  timeOfDay: z.enum(TIMES_OF_DAY),
  notes: z.string().max(500).optional(),
});

export const feedingPlanSchema = baseRecordSchema
  .extend({
    name: z.string().min(1, "A feeding plan needs a name").max(120),
    target: z.enum(FEEDING_TARGETS),
    targetId: ulidSchema,
    // Defaulted rather than optional: every plan written before this field
    // existed fed exactly one animal, and a missing array reaching the
    // resolver as `undefined` would be a crash on records already in the
    // database rather than on anything anybody typed.
    alsoFeeds: z.array(ulidSchema).default([]),
    lines: z.array(planLineSchema).min(1, "A feeding plan needs at least one line"),
    portion: z.enum(PORTIONS).default("per_head"),
    active: z.boolean(),
    specialNotes: z.string().max(5000).optional(),
  })
  .refine((plan) => plan.target === "animal" || plan.alsoFeeds.length === 0, {
    // A zone or group plan already names its population; a second list beside
    // it would be two answers to "who eats this" with nothing to break the tie.
    message: "Only a plan aimed at one animal can name others sharing with it",
    path: ["alsoFeeds"],
  })
  .refine((plan) => !plan.alsoFeeds.includes(plan.targetId), {
    message: "That animal is already the one this plan feeds",
    path: ["alsoFeeds"],
  })
  .refine((plan) => new Set(plan.alsoFeeds).size === plan.alsoFeeds.length, {
    // A duplicate would count a head twice when the bowl is split, which is
    // the one arithmetic this field exists to get right.
    message: "The same animal is named twice",
    path: ["alsoFeeds"],
  }) as unknown as z.ZodType<FeedingPlan>;

/**
 * Every animal an animal-targeted plan feeds, the named one first.
 *
 * `alsoFeeds` is read defensively, and that is not belt-and-braces. The schema
 * defaults it on the way *in*, but these functions are handed records on the
 * way *out* — off a device that has held them since before the field existed,
 * and whose copy gains it only on the next pull. A spread over `undefined`
 * throws, so the plan somebody has been feeding for a year would take the
 * screen down rather than the new one they just wrote.
 */
export function animalsFedBy(plan: Pick<FeedingPlan, "target" | "targetId" | "alsoFeeds">): Ulid[] {
  return plan.target === "animal" ? [plan.targetId, ...(plan.alsoFeeds ?? [])] : [];
}

/** How to read a plan's amounts. A record from before the field is per-head. */
export function portionOf(plan: Pick<FeedingPlan, "portion">): Portion {
  return plan.portion ?? "per_head";
}

/** Is this one amount split between everybody it covers? */
export function isShared(plan: Pick<FeedingPlan, "portion">): boolean {
  return portionOf(plan) === "shared";
}

/** Feedings per day, averaged — `every_other_day` is 0.5, weekly is 1/7. */
export function feedingsPerDay(frequency: FeedingFrequency): number {
  switch (frequency) {
    case "once_daily":
      return 1;
    case "twice_daily":
      return 2;
    case "three_times_daily":
      return 3;
    case "every_other_day":
      return 0.5;
    case "weekly":
      return 1 / 7;
  }
}

/**
 * Daily demand for one plan, per feed type (spec §5.3: Σ quantity × frequency).
 *
 * Returned per feed type rather than as a single total because the units
 * differ — a plan feeding twelve pounds of grain and half a round bale of hay
 * has no meaningful sum, and adding one would be the kind of number that looks
 * right and is not.
 */
export function dailyDemandOf(plan: Pick<FeedingPlan, "lines" | "active">): Map<Ulid, Quantity> {
  const demand = new Map<Ulid, Quantity>();
  if (!plan.active) return demand;

  for (const line of plan.lines) {
    const perDay = line.amount.amount * feedingsPerDay(line.frequency);
    const existing = demand.get(line.feedTypeId);

    if (existing === undefined) {
      demand.set(line.feedTypeId, { amount: perDay, unit: line.amount.unit });
      continue;
    }

    // Two lines of the same feed at different times — the classic morning and
    // evening grain split. Same unit or the plan is nonsense, so say so rather
    // than silently keeping one.
    if (existing.unit !== line.amount.unit) {
      throw new Error(
        `Feeding plan mixes units for one feed type: ${existing.unit} and ${line.amount.unit}`,
      );
    }
    demand.set(line.feedTypeId, { amount: existing.amount + perDay, unit: existing.unit });
  }

  return demand;
}

/**
 * The plans that apply to one animal, most specific last.
 *
 * Order is the point: §5.1 says an animal-targeted plan "overrides/extends the
 * group plan", so a caller folding these in order lets the specific one win.
 */
export function plansForAnimal(
  plans: readonly FeedingPlan[],
  animalId: Ulid,
  zoneIds: readonly Ulid[],
  groupIds: readonly Ulid[] = [],
): FeedingPlan[] {
  const applies = (plan: FeedingPlan): boolean => {
    if (!plan.active) return false;
    // `alsoFeeds` is why this is not an equality check any more: a bowl two
    // cats eat out of is one plan, and both of them have to find it.
    if (plan.target === "animal") return animalsFedBy(plan).includes(animalId);
    if (plan.target === "zone") return zoneIds.includes(plan.targetId);
    return groupIds.includes(plan.targetId);
  };

  const rank: Record<FeedingTarget, number> = { group: 0, zone: 1, animal: 2 };
  return plans.filter(applies).sort((left, right) => rank[left.target] - rank[right.target]);
}
