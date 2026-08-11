import {
  dailyDemandOf,
  plansForAnimal,
  type FeedingPlan,
  type Money,
  type Ulid,
} from "@galaxy-farm/core";

import { weightedAverageCost, type FeedPurchase } from "./inventory.js";

/**
 * Who the feed bill belongs to (spec §5.3, "cost per head").
 *
 * "Consumption valued at purchase cost, allocated to animals directly (animal
 * plans) or split by headcount (group/zone plans)." The split by headcount is
 * the part worth being careful about: a zone plan feeding four head puts a
 * quarter of the bill on each, and if the pen's population changed mid-month
 * the honest answer is per-day rather than a single division.
 *
 * The output feeds two things that must agree: per-animal P&L (§5.2) and,
 * later, a client calf's boarding invoice (§5.7). "Owner pays feed and
 * supplies" is a rule somebody will be invoiced under, so the number has to be
 * defensible line by line.
 */

export interface AllocationInput {
  readonly plans: readonly FeedingPlan[];
  readonly purchases: readonly FeedPurchase[];
  /** Animals in scope, with the zones and groups each currently belongs to. */
  readonly animals: ReadonlyArray<{
    readonly id: Ulid;
    readonly zoneIds: readonly Ulid[];
    readonly groupIds?: readonly Ulid[];
  }>;
  readonly days: number;
}

export interface AnimalAllocation {
  readonly animalId: Ulid;
  /** What that animal ate, per feed type, over the period. */
  readonly quantityByFeedType: ReadonlyMap<Ulid, number>;
  readonly cost: Money;
  /**
   * False when a feed type in the plan has no purchase behind it.
   *
   * Feed with no recorded purchase is valued at nothing, which understates the
   * animal. §5.2's P&L carries the same distinction for the same reason.
   */
  readonly costComplete: boolean;
}

/**
 * Daily demand per feed type for one animal, resolving plan precedence.
 *
 * §5.1: an animal-targeted plan "overrides/extends the group plan". Extends
 * for feed types the specific plan does not mention, overrides for the ones it
 * does — a per-cow grain ration replaces the pen's grain and leaves the pen's
 * mineral alone.
 */
export function resolvedDemandFor(
  plans: readonly FeedingPlan[],
  animalId: Ulid,
  zoneIds: readonly Ulid[],
  groupIds: readonly Ulid[] = [],
): Map<Ulid, number> {
  const resolved = new Map<Ulid, number>();

  // `plansForAnimal` returns group, then zone, then animal — least specific
  // first — so a later plan overwriting an earlier one is precedence working.
  for (const plan of plansForAnimal(plans, animalId, zoneIds, groupIds)) {
    for (const [feedTypeId, quantity] of dailyDemandOf(plan)) {
      resolved.set(feedTypeId, quantity.amount);
    }
  }

  return resolved;
}

/**
 * Split the feed bill across the animals it fed.
 *
 * Each animal's own resolved demand is what it is charged for, so a headcount
 * split falls out naturally: four head on one zone plan each resolve to the
 * same per-head quantity, and nothing has to divide anything.
 */
export function allocateFeedCost(input: AllocationInput): AnimalAllocation[] {
  const costCache = new Map<Ulid, Money | undefined>();
  const costOf = (feedTypeId: Ulid): Money | undefined => {
    if (!costCache.has(feedTypeId)) {
      costCache.set(feedTypeId, weightedAverageCost(feedTypeId, input.purchases));
    }
    return costCache.get(feedTypeId);
  };

  return input.animals.map((animal) => {
    const perDay = resolvedDemandFor(input.plans, animal.id, animal.zoneIds, animal.groupIds ?? []);
    const quantityByFeedType = new Map<Ulid, number>();
    let cents = 0;
    let complete = true;

    for (const [feedTypeId, daily] of perDay) {
      const quantity = daily * input.days;
      quantityByFeedType.set(feedTypeId, quantity);

      const unitCost = costOf(feedTypeId);
      if (unitCost === undefined) {
        complete = false;
        continue;
      }
      cents += unitCost.cents * quantity;
    }

    return {
      animalId: animal.id,
      quantityByFeedType,
      cost: { cents: Math.round(cents) },
      costComplete: complete,
    };
  });
}

/** The herd's feed bill averaged over the head it fed — §6's "cost per head". */
export function costPerHead(allocations: readonly AnimalAllocation[]): Money {
  if (allocations.length === 0) return { cents: 0 };
  const total = allocations.reduce((sum, allocation) => sum + allocation.cost.cents, 0);
  return { cents: Math.round(total / allocations.length) };
}

/** One animal's share, for the P&L that asks for it by id. */
export function allocationFor(
  allocations: readonly AnimalAllocation[],
  animalId: Ulid,
): AnimalAllocation | undefined {
  return allocations.find((allocation) => allocation.animalId === animalId);
}
