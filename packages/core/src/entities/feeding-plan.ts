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

export interface FeedingPlan extends BaseRecord {
  readonly name: string;
  readonly target: FeedingTarget;
  /** The animal, zone, or group this plan feeds. */
  readonly targetId: Ulid;
  readonly lines: readonly FeedingPlanLine[];
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

export const feedingPlanSchema = baseRecordSchema.extend({
  name: z.string().min(1, "A feeding plan needs a name").max(120),
  target: z.enum(FEEDING_TARGETS),
  targetId: ulidSchema,
  lines: z.array(planLineSchema).min(1, "A feeding plan needs at least one line"),
  active: z.boolean(),
  specialNotes: z.string().max(5000).optional(),
}) as unknown as z.ZodType<FeedingPlan>;

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
    if (plan.target === "animal") return plan.targetId === animalId;
    if (plan.target === "zone") return zoneIds.includes(plan.targetId);
    return groupIds.includes(plan.targetId);
  };

  const rank: Record<FeedingTarget, number> = { group: 0, zone: 1, animal: 2 };
  return plans.filter(applies).sort((left, right) => rank[left.target] - rank[right.target]);
}
