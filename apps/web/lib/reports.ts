import {
  displayName,
  isRoadmapOpen,
  sumMoney,
  totalAcquisitionCost,
  type Animal,
  type Money,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  animalProfitAndLoss,
  cutRevenue,
  cuttingYield,
  dressingPercentage,
  herdRollup,
  poundsKept,
  poundsSold,
  type AcquisitionRecord,
  type AnimalProfitAndLoss,
  type HealthRecord,
  type HerdRollup,
  type ProcessingRecord,
  type SaleRecord,
} from "@galaxy-farm/module-cattle";
import {
  allocateFeedCost,
  poundsOf,
  type FeedPurchase,
  type FeedType,
} from "@galaxy-farm/module-feed";
import type { FeedingPlan } from "@galaxy-farm/core";

/**
 * The reports suite (spec §6, §7 `/admin/reports`).
 *
 * Every one of these is a read model — §4.5's first exception — recomputed
 * from its sources and never stored. Editing a treatment's cost has to move
 * the animal's number, and a cached total is how two screens end up
 * disagreeing about what a cow cost.
 *
 * They live in the composition root because that is the only place they can:
 * a P&L reads records from three modules at once and §4.1 forbids those
 * modules importing each other. The arithmetic itself stays in the modules —
 * `animalProfitAndLoss`, `allocateFeedCost`, `dressingPercentage` are all
 * theirs. What is here is the joining, the naming, and the honesty about what
 * is missing.
 *
 * **Missing is not zero, and every report says which it is.** A herd whose
 * feed has never been catalogued shows a flattering profit, and a report that
 * did not say so would be arithmetically right and practically misleading.
 */

export interface ReportRange {
  readonly from: Date;
  readonly to: Date;
}

export const daysBetween = (range: ReportRange): number =>
  Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000));

const inRange = (date: Date, range: ReportRange): boolean => date >= range.from && date <= range.to;

// ---------------------------------------------------------------- herd P&L

export interface PnlSources {
  readonly animals: readonly Animal[];
  readonly acquisitions: readonly AcquisitionRecord[];
  readonly sales: readonly SaleRecord[];
  readonly health: readonly HealthRecord[];
  readonly processing: readonly ProcessingRecord[];
  readonly plans: readonly FeedingPlan[];
  readonly purchases: readonly FeedPurchase[];
  readonly assignments: readonly ZoneAssignment[];
}

export interface PnlRow extends AnimalProfitAndLoss {
  readonly name: string;
  readonly status: Animal["status"];
}

export interface HerdPnl {
  readonly rows: readonly PnlRow[];
  readonly rollup: HerdRollup;
  /** Animals whose feed could not be costed, because no purchase backs it. */
  readonly feedIncomplete: number;
}

/**
 * Per-animal and herd profit and loss (§5.2, §6).
 *
 * Feed is allocated over the report's own window rather than over the
 * animal's life: §5.3 owns the allocation and it works from plans that
 * describe today, so extrapolating it back across a year the plans did not
 * cover would be inventing figures. The screen states the window it used.
 */
export function herdProfitAndLoss(sources: PnlSources, range: ReportRange): HerdPnl {
  const cattle = sources.animals.filter((animal) => animal.species === "cattle");

  const allocations = allocateFeedCost({
    plans: sources.plans,
    purchases: sources.purchases,
    animals: cattle.map((animal) => ({
      id: animal.id,
      zoneIds: sources.assignments
        .filter(
          (assignment) =>
            assignment.animalId === animal.id &&
            assignment.periodFrom <= range.to &&
            (assignment.periodTo === undefined || assignment.periodTo > range.from),
        )
        .map((assignment) => assignment.zoneId),
    })),
    days: daysBetween(range),
  });

  const rows = cattle.map((animal): PnlRow => {
    const allocation = allocations.find((held) => held.animalId === animal.id);

    return {
      ...animalProfitAndLoss({
        animalId: animal.id,
        acquisitions: sources.acquisitions.filter((record) => inRange(record.date, range)),
        sales: sources.sales.filter((record) => inRange(record.date, range)),
        health: sources.health.filter((record) => inRange(record.date, range)),
        processing: sources.processing.filter((record) => inRange(record.deliveredOn, range)),
        ...(allocation === undefined ? {} : { allocatedFeed: allocation.cost }),
      }),
      name: displayName(animal),
      status: animal.status,
    };
  });

  return {
    rows: [...rows].sort((left, right) => left.net.cents - right.net.cents),
    rollup: herdRollup(rows),
    feedIncomplete: allocations.filter((allocation) => !allocation.costComplete).length,
  };
}

// ------------------------------------------------------------- feed spend

export interface FeedSpendRow {
  readonly feedTypeId: Ulid;
  readonly name: string;
  readonly category: string;
  readonly unit: string;
  readonly purchases: number;
  readonly quantity: number;
  /** Pounds, where the feed knows what a unit of it weighs. */
  readonly pounds?: number | undefined;
  readonly spend: Money;
  readonly averageUnitCost?: Money | undefined;
}

/**
 * What was spent on feed, per feed (§6).
 *
 * Feeds with no purchase in the window are left out rather than listed at
 * zero: a report of forty feeds of which three were bought is a report nobody
 * reads to the bottom of, and "we bought none of it" is visible from its
 * absence in a dated report.
 */
export function feedSpend(
  purchases: readonly FeedPurchase[],
  feeds: readonly FeedType[],
  range: ReportRange,
): FeedSpendRow[] {
  const rows = new Map<Ulid, FeedSpendRow>();

  for (const purchase of purchases) {
    if (!inRange(purchase.purchasedOn, range)) continue;

    const feed = feeds.find((held) => held.id === purchase.feedTypeId);
    const existing = rows.get(purchase.feedTypeId);
    const spend = { cents: Math.round(purchase.unitCost.cents * purchase.quantity) };

    const next: FeedSpendRow = {
      feedTypeId: purchase.feedTypeId,
      name: feed?.name ?? "A feed since deleted",
      category: feed?.category ?? "unknown",
      unit: feed?.unit ?? "unit",
      purchases: (existing?.purchases ?? 0) + 1,
      quantity: (existing?.quantity ?? 0) + purchase.quantity,
      spend: { cents: (existing?.spend.cents ?? 0) + spend.cents },
    };

    rows.set(purchase.feedTypeId, next);
  }

  return [...rows.values()]
    .map((row) => {
      const feed = feeds.find((held) => held.id === row.feedTypeId);
      const pounds = feed === undefined ? undefined : poundsOf(feed, row.quantity);

      return {
        ...row,
        ...(pounds === undefined ? {} : { pounds }),
        averageUnitCost:
          row.quantity === 0 ? undefined : { cents: Math.round(row.spend.cents / row.quantity) },
      };
    })
    .sort((left, right) => right.spend.cents - left.spend.cents);
}

// -------------------------------------------------------- processing yields

export interface YieldRow {
  readonly recordId: Ulid;
  readonly animalId: Ulid;
  readonly name: string;
  readonly deliveredOn: Date;
  readonly liveWeightLb?: number | undefined;
  readonly hangingWeightLb?: number | undefined;
  /** Sixty to sixty-four percent is ordinary for a finished beef animal. */
  readonly dressingPercent?: number | undefined;
  readonly cuttingYieldPercent?: number | undefined;
  readonly poundsKept: number;
  readonly poundsSold: number;
  readonly revenue: Money;
  /** Realised dollars per pound sold — §6's "$/lb realized". */
  readonly pricePerLbSold?: Money | undefined;
}

export function processingYields(
  records: readonly ProcessingRecord[],
  animals: readonly Animal[],
  range: ReportRange,
): YieldRow[] {
  return records
    .filter((record) => inRange(record.deliveredOn, range))
    .map((record): YieldRow => {
      const animal = animals.find((held) => held.id === record.animalId);
      const sold = poundsSold(record);
      const revenue = cutRevenue(record);

      return {
        recordId: record.id,
        animalId: record.animalId,
        name: animal === undefined ? "An animal since deleted" : displayName(animal),
        deliveredOn: record.deliveredOn,
        liveWeightLb: record.liveScaleWeightLb,
        hangingWeightLb: record.hangingWeightLb,
        dressingPercent: dressingPercentage(record),
        cuttingYieldPercent: cuttingYield(record),
        poundsKept: poundsKept(record),
        poundsSold: sold,
        revenue,
        // Only where something was actually sold: dividing by nothing to
        // report "$0/lb" on a beef that went entirely in the freezer would
        // read as a bad sale rather than as no sale.
        ...(sold === 0 ? {} : { pricePerLbSold: { cents: Math.round(revenue.cents / sold) } }),
      };
    })
    .sort((left, right) => right.deliveredOn.getTime() - left.deliveredOn.getTime());
}

// ----------------------------------------------------------- herd growth

export interface GrowthRow {
  readonly year: number;
  readonly target?: number | undefined;
  readonly actual: number;
  readonly title?: string | undefined;
  readonly onTrack?: boolean | undefined;
}

/**
 * Headcount against the roadmap's milestones (§5.2, §6).
 *
 * A milestone's target is read out of its title — "reach 20 head by 2030" —
 * because §5.2 stores herd-size goals as roadmap milestones rather than as a
 * table of their own. A milestone with no number in it is still listed, with
 * no target: a goal somebody phrased in words is a goal, and dropping it from
 * the report would make the roadmap look emptier than it is.
 */
export function herdGrowth(
  animals: readonly Animal[],
  roadmap: readonly RoadmapItem[],
  now: Date,
): GrowthRow[] {
  const milestones = roadmap.filter(
    (item) =>
      item.domain === "cattle" && item.type === "milestone" && item.targetDate !== undefined,
  );

  const onFarm = animals.filter(
    (animal) =>
      animal.species === "cattle" && (animal.status === "active" || animal.status === "boarding"),
  );

  /** Headcount at the end of a year: born by then, and not gone before it. */
  const headcountAt = (year: number): number => {
    const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    if (end > now) return onFarm.length;
    return animals.filter((animal) => {
      if (animal.species !== "cattle") return false;
      if (animal.dob !== undefined && animal.dob > end) return false;
      return animal.diedOn === undefined || animal.diedOn > end;
    }).length;
  };

  return milestones
    .map((item): GrowthRow => {
      const year = (item.targetDate as Date).getUTCFullYear();
      const target = Number(/(\d+)\s*head/i.exec(item.title)?.[1] ?? NaN);
      const actual = headcountAt(year);

      return {
        year,
        actual,
        title: item.title,
        ...(Number.isNaN(target) ? {} : { target, onTrack: actual >= target }),
      };
    })
    .sort((left, right) => left.year - right.year);
}

// --------------------------------------------------------- capital planning

export interface CapitalRow {
  readonly itemId: Ulid;
  readonly title: string;
  readonly domain: string;
  readonly priority: string;
  readonly budget?: Money | undefined;
  readonly candidates: number;
  /** Cheapest true cost among the candidates against this want. */
  readonly best?: Money | undefined;
  readonly overBudget: boolean;
}

/**
 * Open wants, their budgets, and what is being looked at against them (§6).
 *
 * Compared on **total acquisition cost**, never on the asking price — §5.1 is
 * explicit, and hauling a tractor 300 miles and replacing its tyres is real
 * money that decides between two listings.
 */
export function capitalPlan(
  roadmap: readonly RoadmapItem[],
  candidates: readonly PurchaseCandidate[],
): CapitalRow[] {
  return roadmap
    .filter(isRoadmapOpen)
    .filter((item) => item.type === "wishlist" || item.type === "planned_action")
    .map((item): CapitalRow => {
      // Still in the running: a listing that was passed on, or that has gone,
      // is a decision already made and would only pad the comparison.
      const mine = candidates.filter(
        (candidate) =>
          candidate.roadmapItemId === item.id &&
          candidate.status !== "passed" &&
          candidate.status !== "gone",
      );
      const costs = mine.map(totalAcquisitionCost).sort((left, right) => left.cents - right.cents);
      const best = costs[0];

      return {
        itemId: item.id,
        title: item.title,
        domain: item.domain,
        priority: item.priority,
        budget: item.budgetEstimate,
        candidates: mine.length,
        best,
        overBudget:
          item.budgetEstimate !== undefined && best !== undefined
            ? best.cents > item.budgetEstimate.cents
            : false,
      };
    })
    .sort(
      (left, right) =>
        ["need", "want", "someday"].indexOf(left.priority) -
        ["need", "want", "someday"].indexOf(right.priority),
    );
}

// -------------------------------------------------------- operating cost

export interface OperatingLine {
  readonly category: string;
  readonly spend: Money;
  readonly records: number;
  /** Records in this category that carried no figure at all. */
  readonly unpriced: number;
}

export interface OperatingCostSources {
  readonly purchases: readonly FeedPurchase[];
  readonly health: readonly HealthRecord[];
  readonly acquisitions: readonly AcquisitionRecord[];
  readonly processing: readonly ProcessingRecord[];
  readonly pastureCare: ReadonlyArray<{
    readonly performedOn: Date;
    readonly cost?: Money | undefined;
  }>;
}

/**
 * What the place cost to run over a window (§6).
 *
 * Deliberately not called "whole-farm": supplies and equipment do not reach a
 * device yet, so those lines cannot be computed and the screen names them as
 * missing rather than quietly leaving a total that looks complete.
 */
export function operatingCost(sources: OperatingCostSources, range: ReportRange): OperatingLine[] {
  const line = <T>(
    category: string,
    records: readonly T[],
    when: (record: T) => Date,
    cost: (record: T) => Money | undefined,
  ): OperatingLine => {
    const inWindow = records.filter((record) => inRange(when(record), range));
    const amounts = inWindow.map(cost);

    return {
      category,
      spend: sumMoney(amounts.filter((amount): amount is Money => amount !== undefined)),
      records: inWindow.length,
      unpriced: amounts.filter((amount) => amount === undefined).length,
    };
  };

  return [
    line(
      "Feed",
      sources.purchases,
      (record) => record.purchasedOn,
      (record) => ({ cents: Math.round(record.unitCost.cents * record.quantity) }),
    ),
    line(
      "Health and medicine",
      sources.health,
      (record) => record.date,
      (record) => record.cost,
    ),
    line(
      "Animals bought",
      sources.acquisitions,
      (record) => record.date,
      (record) => record.price,
    ),
    line(
      "Processing",
      sources.processing,
      (record) => record.deliveredOn,
      (record) => record.processingCost,
    ),
    line(
      "Pasture care",
      sources.pastureCare,
      (record) => record.performedOn,
      (record) => record.cost,
    ),
  ].filter((entry) => entry.records > 0);
}

/** What the modules that do not sync yet would add. Named, not implied. */
export const REPORTS_AWAITING_MODULES = [
  { report: "Supply spend by category", waitingOn: "the supplies module (§5.11)" },
  { report: "Egg production trends", waitingOn: "the poultry module (§5.4)" },
  { report: "Equipment cost of ownership", waitingOn: "the equipment module (§5.5)" },
  { report: "Business revenue", waitingOn: "Phase 5 (§5.7)" },
] as const;

/** Which zones an animal is in, for a report that wants to say where it lives. */
export function zoneNamesFor(
  animalId: Ulid,
  assignments: readonly ZoneAssignment[],
  zones: readonly Zone[],
  now: Date,
): string[] {
  return assignments
    .filter(
      (assignment) =>
        assignment.animalId === animalId &&
        assignment.periodFrom <= now &&
        (assignment.periodTo === undefined || assignment.periodTo > now),
    )
    .map((assignment) => zones.find((zone) => zone.id === assignment.zoneId)?.name)
    .filter((name): name is string => name !== undefined);
}
