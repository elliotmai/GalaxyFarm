import {
  dailyDemandOf,
  headsOf,
  isTotal,
  plansForAnimal,
  type FeedingPlan,
  type Money,
  type Ulid,
} from "@galaxy-farm/core";

import { inFeedUnit, type FeedType } from "./feed-type.js";
import { feedCost, type FeedCost, type FeedPurchase } from "./inventory.js";

/**
 * Who the feed bill belongs to (spec §5.3, "cost per head").
 *
 * "Consumption valued at purchase cost": an "each" amount is that animal's
 * own, and a "total" amount is split between the plan's animals still on the
 * place. An animal on two plans — a base ration and a supplement — carries
 * both, because a plan owns its animals rather than ranking against others.
 *
 * The output feeds two things that must agree: per-animal P&L (§5.2) and,
 * later, a client calf's boarding invoice (§5.7). "Owner pays feed and
 * supplies" is a rule somebody will be invoiced under, so the number has to be
 * defensible line by line.
 */

export interface AllocationInput {
  readonly plans: readonly FeedingPlan[];
  readonly purchases: readonly FeedPurchase[];
  /** For converting a ration written in scoops into the bags it is bought in. */
  readonly feeds?: readonly Pick<FeedType, "id" | "unit" | "estWeightLbPerUnit">[] | undefined;
  /** The animals on the place, who are the ones a plan's feed is shared by. */
  readonly animals: readonly DemandScope[];
  /** Each flock's headcount, for poultry plans. */
  readonly flocks?: readonly FlockScope[] | undefined;
  readonly days: number;
}

export interface AnimalAllocation {
  readonly animalId: Ulid;
  /** Feed type → quantity over the period, in the feed's own unit. */
  readonly quantityByFeedType: ReadonlyMap<Ulid, number>;
  readonly cost: Money;
  /** False when some feed had no priced purchase or could not be converted. */
  readonly costComplete: boolean;
}

/**
 * An animal on the place.
 *
 * Only the id matters now that a plan names its animals. `zoneIds` survives
 * on the type so callers that still pass it compile; nothing reads it.
 */
export interface DemandScope {
  readonly id: Ulid;
  readonly zoneIds?: readonly Ulid[] | undefined;
}

/** A flock and how many birds are in it today. */
export interface FlockScope {
  readonly id: Ulid;
  readonly heads: number;
}

export interface HerdDemand {
  /** Feed type → per-day amount, in that feed type's own unit. */
  readonly perDay: ReadonlyMap<Ulid, number>;
  /**
   * Feed types a plan feeds in a measure that cannot become the unit the feed
   * is bought in — a scoop of a feed bought by the bale with no weight on it.
   * Reported rather than guessed, so the shed can say why it has no date.
   */
  readonly unconvertible: readonly Ulid[];
}

function context(animals: readonly DemandScope[], flocks: readonly FlockScope[] = []) {
  return {
    onFarm: new Set(animals.map((animal) => animal.id)),
    flockHeads: new Map(flocks.map((flock) => [flock.id, flock.heads])),
  };
}

/**
 * What the place uses in a day, per feed type, in each feed's own unit.
 *
 * Σ over active plans of amount × feedings a day × (heads, for an "each"
 * amount). The run-out projection, the reorder date and the calendar all read
 * this, so a plan written in cups of a feed bought by the bag is converted
 * here, once.
 */
export function herdDemand(input: {
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly Pick<FeedType, "id" | "unit" | "estWeightLbPerUnit">[];
  readonly animals: readonly DemandScope[];
  readonly flocks?: readonly FlockScope[] | undefined;
  /** Accepted and ignored: a plan names its animals, not the place. */
  readonly propertyId?: Ulid | undefined;
}): HerdDemand {
  const feedById = new Map(input.feeds.map((feed) => [feed.id, feed]));
  const { onFarm, flockHeads } = context(input.animals, input.flocks);
  const perDay = new Map<Ulid, number>();
  const unconvertible = new Set<Ulid>();

  for (const plan of input.plans) {
    const heads = headsOf(plan, onFarm, flockHeads);
    for (const [feedTypeId, quantity] of dailyDemandOf(plan, heads)) {
      const feed = feedById.get(feedTypeId);
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
 * Each animal's share of the feed bill over `days`.
 *
 * Flocks are fed but not allocated: a hen has no P&L of her own, and the
 * flock's eggs are where its feed is accounted for.
 */
export function allocateFeedCost(input: AllocationInput): AnimalAllocation[] {
  const costCache = new Map<Ulid, FeedCost>();
  const costOf = (feedTypeId: Ulid): FeedCost => {
    let cost = costCache.get(feedTypeId);
    if (cost === undefined) {
      cost = feedCost(feedTypeId, input.purchases);
      costCache.set(feedTypeId, cost);
    }
    return cost;
  };

  const feedById = new Map((input.feeds ?? []).map((feed) => [feed.id, feed]));
  const { onFarm, flockHeads } = context(input.animals, input.flocks);

  return input.animals.map((animal) => {
    const quantityByFeedType = new Map<Ulid, number>();
    let cents = 0;
    let complete = true;

    for (const plan of plansForAnimal(input.plans, animal.id)) {
      const heads = headsOf(plan, onFarm, flockHeads);
      if (heads === 0) continue;
      // One head's worth: the plan's demand for one animal, or the total
      // divided by everybody sharing it.
      for (const [feedTypeId, ration] of dailyDemandOf(plan, 1)) {
        const feed = feedById.get(feedTypeId);
        const whole =
          feed === undefined ? ration.amount : inFeedUnit(feed, ration.amount, ration.unit);
        if (whole === undefined) {
          complete = false;
          continue;
        }

        const daily = isTotal(plan) ? whole / heads : whole;
        const quantity = daily * input.days;
        quantityByFeedType.set(feedTypeId, (quantityByFeedType.get(feedTypeId) ?? 0) + quantity);

        const { average, complete: priced } = costOf(feedTypeId);
        if (!priced) complete = false;
        if (average === undefined) continue;
        cents += average.cents * quantity;
      }
    }

    return {
      animalId: animal.id,
      quantityByFeedType,
      cost: { cents: Math.round(cents) },
      costComplete: complete,
    };
  });
}

/** Average cost per animal across an allocation. */
export function costPerHead(allocations: readonly AnimalAllocation[]): Money {
  if (allocations.length === 0) return { cents: 0 };
  const total = allocations.reduce((sum, allocation) => sum + allocation.cost.cents, 0);
  return { cents: Math.round(total / allocations.length) };
}

export function allocationFor(
  allocations: readonly AnimalAllocation[],
  animalId: Ulid,
): AnimalAllocation | undefined {
  return allocations.find((allocation) => allocation.animalId === animalId);
}
