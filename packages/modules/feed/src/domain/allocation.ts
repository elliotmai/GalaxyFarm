import {
  dailyDemandOf,
  plansForAnimal,
  type FeedingPlan,
  type Money,
  type Quantity,
  type Ulid,
} from "@galaxy-farm/core";

import { inFeedUnit, type FeedType } from "./feed-type.js";
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
  /**
   * The catalogue, so a ration can be restated in what the feed is bought by.
   *
   * A unit cost is per purchase unit — per bag — and a ration written in
   * scoops multiplied by that price is a feed bill eighteen times too large.
   * Optional only so an existing caller keeps working; without it a ration in
   * another unit is charged at face value, which is exactly the mistake.
   */
  readonly feeds?: readonly Pick<FeedType, "id" | "unit" | "estWeightLbPerUnit">[] | undefined;
  /** Animals in scope, with the zones and groups each currently belongs to. */
  readonly animals: readonly DemandScope[];
  /** The group a "whole group" plan targets. Without it, group plans bill nobody. */
  readonly propertyId?: Ulid | undefined;
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
 *
 * The unit travels with the amount and is not dropped. A ration is written in
 * what it is fed in — scoops — and stock is counted in what it is bought in —
 * bags, and a bare number that means one on one screen and the other on the
 * next is a fault nothing downstream can detect. `herdDemand` is what turns
 * these into the feed's own unit.
 */
export function resolvedDemandFor(
  plans: readonly FeedingPlan[],
  animalId: Ulid,
  zoneIds: readonly Ulid[],
  groupIds: readonly Ulid[] = [],
): Map<Ulid, Quantity> {
  const resolved = new Map<Ulid, Quantity>();

  // `plansForAnimal` returns group, then zone, then animal — least specific
  // first — so a later plan overwriting an earlier one is precedence working.
  for (const plan of plansForAnimal(plans, animalId, zoneIds, groupIds)) {
    for (const [feedTypeId, quantity] of dailyDemandOf(plan)) {
      resolved.set(feedTypeId, quantity);
    }
  }

  return resolved;
}

/** An animal, and everything a plan could be targeting it through. */
export interface DemandScope {
  readonly id: Ulid;
  readonly zoneIds: readonly Ulid[];
  readonly groupIds?: readonly Ulid[] | undefined;
}

export interface HerdDemand {
  /** Per feed type, per day, in the unit that feed is bought and counted in. */
  readonly perDay: ReadonlyMap<Ulid, number>;
  /**
   * Feeds whose ration cannot be restated in the unit they are counted in.
   *
   * Named rather than silently dropped or silently passed through raw. A feed
   * missing from a run-out projection is a barn that empties without warning,
   * and a scoop counted as a bag is the same thing eighteen times faster —
   * both look completely ordinary on screen, so the only safe answer is to say
   * which feed could not be worked out.
   */
  readonly unconvertible: readonly Ulid[];
}

/**
 * What the whole herd eats in a day, per feed type (spec §5.3).
 *
 * The one place this is worked out, because two screens ask it and they have
 * to agree. Three things it gets right that summing plans does not:
 *
 * **It counts heads.** Each animal resolves its own plans and contributes its
 * own ration, so a pen of forty runs the barn down forty times as fast. A sum
 * over plans counts a group plan once, which is not what anybody is carrying
 * to the trough.
 *
 * **It converts.** A ration in scoops against stock counted in bags is an
 * eighteen-fold error, in the direction that empties a barn without warning.
 *
 * **It knows what a group plan is.** A plan targeting the whole group names
 * the property, and every animal on the property belongs to it — which is not
 * something `plansForAnimal` can know, since it is handed group ids and the
 * property is not one of them. Passing `propertyId` here is what makes the
 * commonest kind of plan visible to the run-out projection at all.
 */
export function herdDemand(input: {
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly Pick<FeedType, "id" | "unit" | "estWeightLbPerUnit">[];
  readonly animals: readonly DemandScope[];
  /** The group a "whole group" plan targets. */
  readonly propertyId?: Ulid | undefined;
}): HerdDemand {
  const feedById = new Map(input.feeds.map((feed) => [feed.id, feed]));
  const perDay = new Map<Ulid, number>();
  const unconvertible = new Set<Ulid>();

  for (const animal of input.animals) {
    const groups =
      input.propertyId === undefined
        ? (animal.groupIds ?? [])
        : [input.propertyId, ...(animal.groupIds ?? [])];

    for (const [feedTypeId, quantity] of resolvedDemandFor(
      input.plans,
      animal.id,
      animal.zoneIds,
      groups,
    )) {
      const feed = feedById.get(feedTypeId);
      // A ration for a feed no longer in the catalogue is taken at face value:
      // there is nothing to convert to, and dropping it would understate a
      // barn that is genuinely being emptied.
      const counted =
        feed === undefined ? quantity.amount : inFeedUnit(feed, quantity.amount, quantity.unit);

      if (counted === undefined) {
        unconvertible.add(feedTypeId);
        continue;
      }
      perDay.set(feedTypeId, (perDay.get(feedTypeId) ?? 0) + counted);
    }
  }

  return { perDay, unconvertible: [...unconvertible] };
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

  const feedById = new Map((input.feeds ?? []).map((feed) => [feed.id, feed]));

  return input.animals.map((animal) => {
    const groups =
      input.propertyId === undefined
        ? (animal.groupIds ?? [])
        : [input.propertyId, ...(animal.groupIds ?? [])];
    const perDay = resolvedDemandFor(input.plans, animal.id, animal.zoneIds, groups);
    const quantityByFeedType = new Map<Ulid, number>();
    let cents = 0;
    let complete = true;

    for (const [feedTypeId, ration] of perDay) {
      const feed = feedById.get(feedTypeId);
      // Priced per purchase unit, so the ration has to be in purchase units
      // before it is multiplied by anything.
      const daily =
        feed === undefined ? ration.amount : inFeedUnit(feed, ration.amount, ration.unit);
      if (daily === undefined) {
        // No honest quantity means no honest cost, and a bill that quietly
        // leaves an animal's grain out is one somebody gets invoiced under.
        complete = false;
        continue;
      }

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
