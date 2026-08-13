import {
  compareToBudget,
  isRoadmapOpen,
  money,
  PRIORITIES,
  sumMoney,
  totalAcquisitionCost,
  type Money,
  type Priority,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
} from "@galaxy-farm/core";

/**
 * Where the horses are going, years before there are any (spec §5.9).
 *
 * There is no HorseRoadmap entity and there should not be one: §5.9 says
 * "same Roadmap aggregate as cattle", and the kernel's `RoadmapItem` already
 * carries a `domain`. What belongs here is the reading of it that is specific
 * to horses — a shopping list nobody has walked yet, priced against what is
 * actually under consideration.
 *
 * These are derivations (§4.5 exception 1): nothing here is stored, so editing
 * a budget estimate or passing on a candidate moves the answer immediately.
 */

/** Only the horse items. The same table holds cattle's and equipment's. */
export function horseItems(items: readonly RoadmapItem[]): RoadmapItem[] {
  return items.filter((item) => item.domain === "horses");
}

/** Only the horse candidates, from the aggregate all three domains share. */
export function horseCandidates(candidates: readonly PurchaseCandidate[]): PurchaseCandidate[] {
  return candidates.filter((candidate) => candidate.domain === "horses");
}

export interface BudgetOutlook {
  /** Estimated spend on the open items, by how badly they are wanted. */
  readonly byPriority: Readonly<Record<Priority, Money>>;
  readonly total: Money;
  /**
   * Open items carrying no estimate.
   *
   * Reported rather than treated as zero. A total that quietly counts an
   * unpriced want as free is a total somebody will plan against.
   */
  readonly unpriced: number;
}

/**
 * What the plan would cost if it all happened.
 *
 * Open items only — an achieved milestone is not a future cost, and a dropped
 * one never was. §5.9's "budget planning starts today" is this: the number is
 * available years before the first horse, because the wants are.
 */
export function budgetOutlook(items: readonly RoadmapItem[]): BudgetOutlook {
  const open = horseItems(items).filter(isRoadmapOpen);

  const byPriority = Object.fromEntries(
    PRIORITIES.map((priority) => [
      priority,
      sumMoney(
        open
          .filter((item) => item.priority === priority)
          .map((item) => item.budgetEstimate)
          .filter((estimate): estimate is Money => estimate !== undefined),
      ),
    ]),
  ) as Record<Priority, Money>;

  return {
    byPriority,
    total: sumMoney(PRIORITIES.map((priority) => byPriority[priority])),
    unpriced: open.filter((item) => item.budgetEstimate === undefined).length,
  };
}

export interface RoadmapStep {
  readonly item: RoadmapItem;
  /** A target date that has passed with the item still open. */
  readonly overdue: boolean;
}

/**
 * What to do next: needs, then wants, then somedays.
 *
 * Within a priority, whoever has a date goes before whoever does not — an item
 * with a target has somewhere to be, and one without is waiting on the ones
 * that do.
 */
export function nextUp(items: readonly RoadmapItem[], now: Date): RoadmapStep[] {
  return horseItems(items)
    .filter(isRoadmapOpen)
    .map((item) => ({
      item,
      overdue: item.targetDate !== undefined && item.targetDate.getTime() < now.getTime(),
    }))
    .sort((left, right) => {
      const byPriority =
        PRIORITIES.indexOf(left.item.priority) - PRIORITIES.indexOf(right.item.priority);
      if (byPriority !== 0) return byPriority;

      const leftDate = left.item.targetDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightDate = right.item.targetDate?.getTime() ?? Number.POSITIVE_INFINITY;
      if (leftDate !== rightDate) return leftDate - rightDate;

      return left.item.title.localeCompare(right.item.title);
    });
}

export interface ItemShopping {
  readonly item: RoadmapItem;
  /** Candidates still in play against this want. */
  readonly live: readonly PurchaseCandidate[];
  /** The cheapest of them on total acquisition cost, not on the asking price. */
  readonly cheapest?: PurchaseCandidate | undefined;
  /** Cheapest against the estimate, when the item carries one. */
  readonly overBudget?: boolean | undefined;
}

/** Candidates that have been ruled out one way or another. */
function isLive(candidate: PurchaseCandidate): boolean {
  return (
    candidate.status !== "purchased" && candidate.status !== "passed" && candidate.status !== "gone"
  );
}

/**
 * Each want, with what is actually being looked at against it.
 *
 * The pairing is the point. A wishlist item with a budget and no candidate is
 * a plan nobody has started; a candidate over the estimate is a decision to
 * make rather than a form to fill in — and §5.1's rule holds here too, so
 * "over budget" is decided on the all-in cost and never on the sticker.
 */
export function shoppingFor(
  items: readonly RoadmapItem[],
  candidates: readonly PurchaseCandidate[],
  types: readonly RoadmapItem["type"][] = ["wishlist", "planned_action"],
): ItemShopping[] {
  const live = horseCandidates(candidates).filter(isLive);

  return horseItems(items)
    .filter(isRoadmapOpen)
    .filter((item) => types.includes(item.type))
    .map((item) => {
      const mine = live.filter((candidate) => candidate.roadmapItemId === item.id);
      const cheapest = [...mine].sort(
        (left, right) => totalAcquisitionCost(left).cents - totalAcquisitionCost(right).cents,
      )[0];

      return {
        item,
        live: mine,
        ...(cheapest === undefined ? {} : { cheapest }),
        ...(cheapest === undefined || item.budgetEstimate === undefined
          ? {}
          : { overBudget: compareToBudget(cheapest, item.budgetEstimate).overBudget }),
      };
    });
}

/**
 * Wants with nothing under consideration.
 *
 * The list that turns a roadmap into something to do this weekend: these are
 * the ones where the shopping has not started, as distinct from the ones where
 * it has and nothing has been good enough yet.
 */
export function unshopped(
  items: readonly RoadmapItem[],
  candidates: readonly PurchaseCandidate[],
): RoadmapItem[] {
  return shoppingFor(items, candidates)
    .filter((entry) => entry.live.length === 0)
    .map((entry) => entry.item);
}

/**
 * What the horses have already cost, against what was set aside for them.
 *
 * Purchased candidates only: the money is spent when the horse is bought, and
 * counting the ones still being looked at would make the figure move every
 * time somebody adds a listing.
 */
export function spentAgainstPlan(
  items: readonly RoadmapItem[],
  candidates: readonly PurchaseCandidate[],
): { readonly spent: Money; readonly planned: Money; readonly remaining: Money } {
  const spent = sumMoney(
    horseCandidates(candidates)
      .filter((candidate) => candidate.status === "purchased")
      .map((candidate) => totalAcquisitionCost(candidate)),
  );
  const planned = budgetOutlook(items).total;

  return { spent, planned, remaining: money(planned.cents - spent.cents) };
}

/** The want a candidate is being bought against, if it names one. */
export function wantFor(
  candidate: Pick<PurchaseCandidate, "roadmapItemId">,
  items: readonly RoadmapItem[],
): RoadmapItem | undefined {
  const id: Ulid | undefined = candidate.roadmapItemId;
  return id === undefined ? undefined : horseItems(items).find((item) => item.id === id);
}
