import { describe, expect, it } from "vitest";

import { fromDollars, quantity, type FeedingPlan, type Ulid } from "@galaxy-farm/core";

import { feedTypeSchema, poundsOf, type FeedType } from "../src/domain/feed-type.js";
import {
  feedConsumptionSchema,
  feedPurchaseSchema,
  lastReconciledOn,
  onHand,
  plannedConsumption,
  projectFeed,
  reorderOn,
  runOutDate,
  weightedAverageCost,
  type FeedConsumption,
  type FeedPurchase,
} from "../src/domain/inventory.js";
import {
  allocateFeedCost,
  allocationFor,
  costPerHead,
  resolvedDemandFor,
} from "../src/domain/allocation.js";

/**
 * Feed (spec §5.3).
 *
 * The run-out projection is what the "buy more hay" notification stands on,
 * and the allocation is what a client calf's boarding invoice will be built
 * from. Both need to be defensible line by line.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-11-01T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const HAY = id(1);
const GRAIN = id(2);

const hay: FeedType = {
  id: HAY,
  ...base,
  name: "Round bale hay",
  category: "hay",
  unit: "round_bale",
  estWeightLbPerUnit: 1100,
  reorderLeadDays: 7,
  reorderThreshold: 3,
  active: true,
};

const purchase = (over: Partial<FeedPurchase> = {}): FeedPurchase => ({
  id: id(10),
  ...base,
  feedTypeId: HAY,
  quantity: 10,
  unitCost: fromDollars(85),
  purchasedOn: new Date("2026-10-01"),
  ...over,
});

const used = (over: Partial<FeedConsumption> = {}): FeedConsumption => ({
  id: id(20),
  ...base,
  feedTypeId: HAY,
  quantity: 2,
  kind: "extra",
  usedOn: new Date("2026-10-20"),
  ...over,
});

describe("feedTypeSchema", () => {
  it("accepts a real feed", () => {
    expect(feedTypeSchema.safeParse(hay).success).toBe(true);
  });

  it("refuses a unit feed is not bought in", () => {
    // The kernel's unit list covers doses and acres too. A feed measured in
    // millilitres is a medicine somebody filed in the wrong place.
    expect(feedTypeSchema.safeParse({ ...hay, unit: "ml" }).success).toBe(false);
  });
});

describe("poundsOf", () => {
  it("converts bales to pounds through the estimated bale weight", () => {
    // A round bale is 800 to 1,400 lb depending on who baled it, which is why
    // this is an estimate stored per feed rather than a constant.
    expect(poundsOf(hay, 3)).toBe(3300);
  });

  it("passes weights straight through", () => {
    expect(poundsOf({ unit: "lb" }, 40)).toBe(40);
    expect(poundsOf({ unit: "ton" }, 1)).toBe(2000);
  });

  it("says nothing for a bale with no weight estimate rather than guessing", () => {
    expect(poundsOf({ unit: "round_bale" }, 3)).toBeUndefined();
  });
});

describe("onHand", () => {
  it("is purchases minus consumption", () => {
    expect(onHand(HAY, [purchase()], [used()])).toBe(8);
  });

  it("ignores another feed's records", () => {
    const grain = purchase({ id: id(11), feedTypeId: GRAIN, quantity: 40 });
    expect(onHand(HAY, [purchase(), grain], [])).toBe(10);
  });

  it("is allowed to go negative, because that is information", () => {
    // A negative on-hand means the records disagree with the barn. Clamping it
    // to zero hides the discrepancy; the fix is a correction entry, which is a
    // record of the disagreement rather than a silent overwrite.
    expect(onHand(HAY, [purchase({ quantity: 2 })], [used({ quantity: 5 })])).toBe(-3);
  });
});

describe("lastReconciledOn and plannedConsumption", () => {
  it("counts from the first purchase when nobody has counted the barn", () => {
    expect(lastReconciledOn(HAY, [purchase()], [])).toEqual(new Date("2026-10-01"));
  });

  it("prefers the most recent correction to the purchase date", () => {
    const early = used({ kind: "correction", usedOn: new Date("2026-10-10") });
    const late = used({ id: id(21), kind: "correction", usedOn: new Date("2026-10-25") });

    expect(lastReconciledOn(HAY, [purchase()], [early, late])).toEqual(new Date("2026-10-25"));
  });

  it("ignores an ordinary extra — that is feed used, not a count", () => {
    expect(lastReconciledOn(HAY, [purchase()], [used()])).toEqual(new Date("2026-10-01"));
  });

  it("says nothing for a feed never bought and never counted", () => {
    expect(lastReconciledOn(GRAIN, [purchase()], [])).toBeUndefined();
  });

  it("never accrues backwards", () => {
    expect(plannedConsumption(0.5, AT, new Date("2026-10-01"))).toBe(0);
  });
});

describe("weightedAverageCost", () => {
  it("weights by quantity, not by number of loads", () => {
    // Twenty bales at $85 and two at $120 is not $102.50 a bale.
    const cheap = purchase({ quantity: 20, unitCost: fromDollars(85) });
    const dear = purchase({ id: id(12), quantity: 2, unitCost: fromDollars(120) });

    expect(weightedAverageCost(HAY, [cheap, dear])).toEqual({ cents: 8818 });
  });

  it("says nothing for a feed never bought", () => {
    expect(weightedAverageCost(GRAIN, [purchase()])).toBeUndefined();
  });
});

describe("runOutDate", () => {
  it("divides what is left by what goes out each day", () => {
    expect(runOutDate(10, 0.5, AT)).toEqual(new Date("2026-11-21T12:00:00Z"));
  });

  it("says nothing when nothing is being fed", () => {
    // Dividing by zero demand gives Infinity, and "runs out: never" is a claim
    // the app cannot support the moment somebody activates a plan.
    expect(runOutDate(10, 0, AT)).toBeUndefined();
  });

  it("says today when the barn is already empty", () => {
    expect(runOutDate(0, 2, AT)).toBe(AT);
  });
});

describe("reorderOn", () => {
  it("leads the run-out by the supplier's lead time", () => {
    // Ordering on the run-out date is ordering a week late.
    expect(reorderOn(hay, new Date("2026-11-21T12:00:00Z"))).toEqual(
      new Date("2026-11-14T12:00:00Z"),
    );
  });

  it("says nothing when there is no run-out date to lead", () => {
    expect(reorderOn(hay, undefined)).toBeUndefined();
  });
});

describe("projectFeed", () => {
  const demand = new Map([[HAY, 0.5]]);

  it("subtracts what the plans say has been fed since the count was last right", () => {
    // The gap this closes: nobody logs the ordinary daily feeding, so an
    // on-hand of purchases minus logged entries would sit at ten bales while
    // the barn emptied, and the run-out date would never arrive. Bought
    // 1 October, projecting on 1 November: thirty-one days at half a bale.
    const projection = projectFeed(hay, [purchase()], [], demand, AT);

    expect(projection.reconciledOn).toEqual(new Date("2026-10-01"));
    expect(projection.plannedConsumed).toBeCloseTo(15.75, 5);
    expect(projection.onHand).toBeCloseTo(-5.75, 5);
  });

  it("restarts the accrual from a correction, which is somebody counting the barn", () => {
    const counted = used({ kind: "correction", quantity: 0.5, usedOn: new Date("2026-10-30") });
    const projection = projectFeed(hay, [purchase()], [counted], demand, AT);

    expect(projection.reconciledOn).toEqual(new Date("2026-10-30"));
    // Ten bought, half corrected away, two and a half days at half a bale.
    expect(projection.onHand).toBeCloseTo(8.25, 5);
    expect(projection.runsOutOn).toEqual(new Date("2026-11-17T12:00:00Z"));
    expect(projection.orderBy).toEqual(new Date("2026-11-10T12:00:00Z"));
    expect(projection.orderNow).toBe(false);
  });

  it("says order now once the lead time has been reached", () => {
    const counted = used({ kind: "correction", quantity: 0.5, usedOn: new Date("2026-10-30") });
    const late = projectFeed(
      hay,
      [purchase()],
      [counted],
      demand,
      new Date("2026-11-12T12:00:00Z"),
    );

    expect(late.orderNow).toBe(true);
  });

  it("accrues nothing for a feed nobody is feeding", () => {
    const projection = projectFeed(hay, [purchase()], [], new Map(), AT);
    expect(projection.plannedConsumed).toBe(0);
    expect(projection.onHand).toBe(10);
  });

  it("flags low stock independently of the run-out date", () => {
    // Two ways to be short: running out soon, or being under the threshold at
    // all. A feed nobody is currently feeding has no run-out date but can
    // still be down to its last bale.
    const low = projectFeed(hay, [purchase({ quantity: 2 })], [], new Map(), AT);

    expect(low.belowThreshold).toBe(true);
    expect(low.runsOutOn).toBeUndefined();
  });

  it("accrues nothing for a feed never bought", () => {
    const projection = projectFeed({ ...hay, id: GRAIN }, [], [], new Map([[GRAIN, 12]]), AT);
    expect(projection.reconciledOn).toBeUndefined();
    expect(projection.onHand).toBe(0);
  });
});

describe("purchase and consumption schemas", () => {
  it("refuse a quantity of zero on either side", () => {
    expect(feedPurchaseSchema.safeParse({ ...purchase(), quantity: 0 }).success).toBe(false);
    expect(feedConsumptionSchema.safeParse({ ...used(), quantity: 0 }).success).toBe(false);
  });

  it("accept real entries", () => {
    expect(feedPurchaseSchema.safeParse(purchase()).success).toBe(true);
    expect(feedConsumptionSchema.safeParse(used()).success).toBe(true);
  });
});

// ---------------------------------------------------------------- allocation

const plan = (over: Partial<FeedingPlan> = {}): FeedingPlan => ({
  id: id(30),
  ...base,
  name: "Pasture cows",
  target: "zone",
  targetId: id(40),
  active: true,
  lines: [
    {
      feedTypeId: HAY,
      amount: quantity(0.25, "round_bale"),
      frequency: "once_daily",
      timeOfDay: "morning",
    },
  ],
  ...over,
});

describe("resolvedDemandFor", () => {
  it("takes the zone plan for an animal with no plan of its own", () => {
    const demand = resolvedDemandFor([plan()], id(50), [id(40)]);
    expect(demand.get(HAY)).toBe(0.25);
  });

  it("lets an animal plan override the pen's ration for the same feed", () => {
    const own = plan({
      id: id(31),
      target: "animal",
      targetId: id(50),
      lines: [
        {
          feedTypeId: HAY,
          amount: quantity(0.4, "round_bale"),
          frequency: "once_daily",
          timeOfDay: "morning",
        },
      ],
    });

    expect(resolvedDemandFor([plan(), own], id(50), [id(40)]).get(HAY)).toBe(0.4);
  });

  it("extends rather than replaces for a feed the specific plan does not mention", () => {
    // A per-cow grain ration replaces the pen's grain and leaves its mineral
    // alone. Replacing the whole plan would silently stop her mineral.
    const own = plan({
      id: id(32),
      target: "animal",
      targetId: id(50),
      lines: [
        {
          feedTypeId: GRAIN,
          amount: quantity(6, "lb"),
          frequency: "twice_daily",
          timeOfDay: "morning",
        },
      ],
    });

    const demand = resolvedDemandFor([plan(), own], id(50), [id(40)]);

    expect(demand.get(HAY)).toBe(0.25);
    expect(demand.get(GRAIN)).toBe(12);
  });

  it("gives nothing to an animal no plan covers", () => {
    expect(resolvedDemandFor([plan()], id(51), [id(99)]).size).toBe(0);
  });
});

describe("allocateFeedCost", () => {
  const animals = [
    { id: id(50), zoneIds: [id(40)] },
    { id: id(51), zoneIds: [id(40)] },
    { id: id(52), zoneIds: [id(40)] },
    { id: id(53), zoneIds: [id(40)] },
  ];

  it("charges each head its own resolved ration, which is the headcount split", () => {
    // Four head on one zone plan each resolve to the same per-head quantity,
    // so nothing has to divide anything.
    const allocations = allocateFeedCost({
      plans: [plan()],
      purchases: [purchase()],
      animals,
      days: 30,
    });

    expect(allocations).toHaveLength(4);
    expect(allocations[0]?.quantityByFeedType.get(HAY)).toBe(7.5);
    expect(allocations[0]?.cost).toEqual(fromDollars(637.5));
  });

  it("charges a cow on her own ration more than her pen-mates", () => {
    const own = plan({
      id: id(33),
      target: "animal",
      targetId: id(50),
      lines: [
        {
          feedTypeId: HAY,
          amount: quantity(0.5, "round_bale"),
          frequency: "once_daily",
          timeOfDay: "morning",
        },
      ],
    });

    const allocations = allocateFeedCost({
      plans: [plan(), own],
      purchases: [purchase()],
      animals,
      days: 30,
    });

    expect(allocationFor(allocations, id(50))?.cost).toEqual(fromDollars(1275));
    expect(allocationFor(allocations, id(51))?.cost).toEqual(fromDollars(637.5));
  });

  it("says the cost is incomplete when a feed has never been bought", () => {
    // Feed with no purchase behind it is valued at nothing, which understates
    // the animal. The P&L carries the same distinction for the same reason.
    const grainPlan = plan({
      id: id(34),
      lines: [
        {
          feedTypeId: GRAIN,
          amount: quantity(6, "lb"),
          frequency: "once_daily",
          timeOfDay: "morning",
        },
      ],
    });

    const allocations = allocateFeedCost({
      plans: [grainPlan],
      purchases: [purchase()],
      animals: [animals[0] as never],
      days: 30,
    });

    expect(allocations[0]?.costComplete).toBe(false);
    expect(allocations[0]?.cost).toEqual(fromDollars(0));
  });

  it("charges nothing to an animal no plan covers", () => {
    const allocations = allocateFeedCost({
      plans: [plan()],
      purchases: [purchase()],
      animals: [{ id: id(60), zoneIds: [id(98)] }],
      days: 30,
    });

    expect(allocations[0]?.cost).toEqual(fromDollars(0));
    expect(allocations[0]?.costComplete).toBe(true);
  });
});

describe("costPerHead", () => {
  it("averages the allocations", () => {
    const allocations = allocateFeedCost({
      plans: [plan()],
      purchases: [purchase()],
      animals: [
        { id: id(50), zoneIds: [id(40)] },
        { id: id(51), zoneIds: [id(40)] },
      ],
      days: 30,
    });

    expect(costPerHead(allocations)).toEqual(fromDollars(637.5));
  });

  it("does not divide by zero on an empty herd", () => {
    expect(costPerHead([])).toEqual(fromDollars(0));
  });
});
