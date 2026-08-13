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
  herdDemand,
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
  alsoFeeds: [],
  portion: "per_head",
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
    // The unit travels with the amount. A ration written in scoops against
    // stock counted in bags is an eighteen-fold error, and a bare number gives
    // nothing downstream any way to notice.
    expect(demand.get(HAY)).toEqual({ amount: 0.25, unit: "round_bale" });
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

    expect(resolvedDemandFor([plan(), own], id(50), [id(40)]).get(HAY)?.amount).toBe(0.4);
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

    expect(demand.get(HAY)?.amount).toBe(0.25);
    expect(demand.get(GRAIN)?.amount).toBe(12);
  });

  it("gives nothing to an animal no plan covers", () => {
    expect(resolvedDemandFor([plan()], id(51), [id(99)]).size).toBe(0);
  });
});

/**
 * The herd's demand (spec §5.3).
 *
 * Two defects lived here and both emptied a barn without saying anything.
 * A group plan reached nobody, so the commonest kind of plan contributed
 * nothing to the run-out date at all; and the plan's unit was dropped, so a
 * ration in scoops was counted against stock in bags — eighteen times too
 * fast, in the direction that runs a place out.
 */
describe("herdDemand", () => {
  const CUBES = id(3);
  const cubes: FeedType = {
    id: CUBES,
    ...base,
    name: "Range cubes",
    category: "grain",
    unit: "bag",
    reorderLeadDays: 7,
    active: true,
  };

  const groupPlan = (over: Partial<FeedingPlan> = {}): FeedingPlan =>
    plan({
      id: id(35),
      target: "group",
      targetId: base.propertyId,
      lines: [
        {
          feedTypeId: CUBES,
          amount: quantity(3, "scoop"),
          frequency: "twice_daily",
          timeOfDay: "morning",
        },
      ],
      ...over,
    });

  const head = (n: number) => ({ id: id(50 + n), zoneIds: [] as Ulid[] });

  it("restates a ration in the unit its feed is counted in", () => {
    // Six scoops is a third of a bag. Counted as six *bags* — which is what a
    // dropped unit amounts to — ten bags on hand runs out this afternoon.
    const demand = herdDemand({
      plans: [groupPlan()],
      feeds: [cubes],
      animals: [head(0)],
      propertyId: base.propertyId,
    });

    expect(demand.perDay.get(CUBES)).toBeCloseTo(6 / 18, 6);
  });

  it("counts a group plan once per head, not once", () => {
    // A pen of forty runs the barn down forty times as fast, and a sum over
    // plans is not what anybody is carrying to the trough.
    const demand = herdDemand({
      plans: [groupPlan()],
      feeds: [cubes],
      animals: [head(0), head(1), head(2)],
      propertyId: base.propertyId,
    });

    expect(demand.perDay.get(CUBES)).toBeCloseTo((6 / 18) * 3, 6);
  });

  it("gives a group plan nobody without the property to target through", () => {
    // The defect, kept as a test: `plansForAnimal` matches a group plan against
    // the ids it is handed, and the property is not one of them. Left out, the
    // commonest kind of plan is invisible to the run-out projection.
    const demand = herdDemand({ plans: [groupPlan()], feeds: [cubes], animals: [head(0)] });

    expect(demand.perDay.size).toBe(0);
  });

  it("leaves a zone plan's animals alone that the zone does not cover", () => {
    expect(
      herdDemand({
        plans: [plan()],
        feeds: [hay],
        animals: [head(0)],
        propertyId: base.propertyId,
      }).perDay.size,
    ).toBe(0);
  });

  it("takes a ration already in the feed's own unit at face value", () => {
    const demand = herdDemand({
      plans: [plan()],
      feeds: [hay],
      animals: [{ id: id(50), zoneIds: [id(40)] }],
      propertyId: base.propertyId,
    });

    expect(demand.perDay.get(HAY)).toBe(0.25);
  });

  it("names a ration it cannot convert rather than counting it wrongly", () => {
    // Cubes catalogued by the bag with no weight given, fed by the... bale.
    // There is no honest number, and both alternatives — dropping it, or
    // passing the raw figure through — look completely ordinary on screen.
    const odd: FeedType = { ...cubes, unit: "block" };
    const demand = herdDemand({
      plans: [groupPlan()],
      feeds: [odd],
      animals: [head(0)],
      propertyId: base.propertyId,
    });

    expect(demand.perDay.size).toBe(0);
    expect(demand.unconvertible).toEqual([CUBES]);
  });

  it("uses the feed's own weight per unit over the standard one", () => {
    // A forty-pound bag rather than a fifty-pound one: six scoops is a larger
    // share of it, and the feed is the only thing that knows.
    const light: FeedType = { ...cubes, estWeightLbPerUnit: 40 };
    const demand = herdDemand({
      plans: [groupPlan()],
      feeds: [light],
      animals: [head(0)],
      propertyId: base.propertyId,
    });

    expect(demand.perDay.get(CUBES)).toBeCloseTo((6 * 50) / 18 / 40, 6);
  });

  it("takes a ration for a feed that has left the catalogue at face value", () => {
    // Nothing to convert to, and dropping it would understate a barn that is
    // genuinely being emptied.
    const demand = herdDemand({
      plans: [groupPlan()],
      feeds: [],
      animals: [head(0)],
      propertyId: base.propertyId,
    });

    expect(demand.perDay.get(CUBES)).toBe(6);
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

describe("what the feed bill is measured in", () => {
  const CUBES = id(3);
  const cubes: FeedType = {
    id: CUBES,
    ...base,
    name: "Range cubes",
    category: "grain",
    unit: "bag",
    reorderLeadDays: 7,
    active: true,
  };

  const scoopPlan = plan({
    id: id(36),
    target: "group",
    targetId: base.propertyId,
    lines: [
      {
        feedTypeId: CUBES,
        amount: quantity(9, "scoop"),
        frequency: "once_daily",
        timeOfDay: "morning",
      },
    ],
  });

  const bought = purchase({
    id: id(15),
    feedTypeId: CUBES,
    quantity: 20,
    unitCost: fromDollars(18),
  });

  it("prices a ration in the unit the feed was bought by", () => {
    // A unit cost is per bag. Nine scoops a day is half a bag, so a week is
    // three and a half bags at $18 — not nine bags a day at $18, which is the
    // bill a dropped unit produces.
    const [allocation] = allocateFeedCost({
      plans: [scoopPlan],
      purchases: [bought],
      feeds: [cubes],
      animals: [{ id: id(50), zoneIds: [] }],
      propertyId: base.propertyId,
      days: 7,
    });

    expect(allocation?.quantityByFeedType.get(CUBES)).toBeCloseTo(3.5, 6);
    expect(allocation?.cost.cents).toBe(Math.round(3.5 * fromDollars(18).cents));
  });

  it("bills nobody for a group plan with no property to target through", () => {
    const [allocation] = allocateFeedCost({
      plans: [scoopPlan],
      purchases: [bought],
      feeds: [cubes],
      animals: [{ id: id(50), zoneIds: [] }],
      days: 7,
    });

    expect(allocation?.quantityByFeedType.size).toBe(0);
  });

  it("says the cost is incomplete rather than inventing a quantity", () => {
    // No weight for the unit it is counted in, so there is no honest quantity
    // — and a bill that quietly leaves an animal's grain out is one somebody
    // gets invoiced under.
    const [allocation] = allocateFeedCost({
      plans: [scoopPlan],
      purchases: [bought],
      feeds: [{ ...cubes, unit: "block" }],
      animals: [{ id: id(50), zoneIds: [] }],
      propertyId: base.propertyId,
      days: 7,
    });

    expect(allocation?.quantityByFeedType.size).toBe(0);
    expect(allocation?.costComplete).toBe(false);
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

// ------------------------------------------------- one bowl, several animals

describe("a ration shared between animals", () => {
  const KIBBLE = id(4);
  const kibble: FeedType = {
    id: KIBBLE,
    ...base,
    name: "Cat food",
    category: "pet",
    unit: "lb",
    reorderLeadDays: 3,
    active: true,
  };

  const SMOKEY = id(60);
  const BOOTS = id(61);

  /** One cup each, twice a day — the same numbers, read the other way. */
  const bowl = (over: Partial<FeedingPlan> = {}): FeedingPlan =>
    plan({
      id: id(70),
      name: "The barn cats",
      target: "animal",
      targetId: SMOKEY,
      alsoFeeds: [BOOTS],
      portion: "shared",
      lines: [
        {
          feedTypeId: KIBBLE,
          amount: quantity(0.5, "lb"),
          frequency: "twice_daily",
          timeOfDay: "morning",
        },
      ],
      ...over,
    });

  const cats = [
    { id: SMOKEY, zoneIds: [] as Ulid[] },
    { id: BOOTS, zoneIds: [] as Ulid[] },
  ];

  it("empties the bag once a day, not twice", () => {
    // The whole point. Two cats eating a pound a day between them is a pound a
    // day; counted per head it is two, and the reorder alert fires a week
    // early every week forever.
    const demand = herdDemand({ plans: [bowl()], feeds: [kibble], animals: cats });

    expect(demand.perDay.get(KIBBLE)).toBeCloseTo(1, 6);
  });

  it("still counts per head when the plan says each", () => {
    // The guard on the change: nothing that was written before this existed
    // may quietly start meaning half as much.
    const demand = herdDemand({
      plans: [bowl({ portion: "per_head" })],
      feeds: [kibble],
      animals: cats,
    });

    expect(demand.perDay.get(KIBBLE)).toBeCloseTo(2, 6);
  });

  it("splits the bill down the middle", () => {
    const allocations = allocateFeedCost({
      plans: [bowl()],
      feeds: [kibble],
      purchases: [purchase({ feedTypeId: KIBBLE, quantity: 100, unitCost: { cents: 200 } })],
      animals: cats,
      days: 10,
    });

    // Ten pounds between them over ten days, five each at $2 a pound.
    expect(allocations.map((a) => a.quantityByFeedType.get(KIBBLE))).toEqual([5, 5]);
    expect(allocations.map((a) => a.cost.cents)).toEqual([1_000, 1_000]);
  });

  it("adds back up to the bowl rather than to twice the bowl", () => {
    const allocations = allocateFeedCost({
      plans: [bowl()],
      feeds: [kibble],
      purchases: [purchase({ feedTypeId: KIBBLE, quantity: 100, unitCost: { cents: 200 } })],
      animals: cats,
      days: 10,
    });

    const total = allocations.reduce((sum, a) => sum + (a.quantityByFeedType.get(KIBBLE) ?? 0), 0);
    expect(total).toBeCloseTo(10, 6);
  });

  it("gives the survivor the whole bowl when the other cat has gone", () => {
    // The divisor is who is actually eating, not who the plan names. A cat
    // that left last month must not still be carrying half the bill.
    const allocations = allocateFeedCost({
      plans: [bowl()],
      feeds: [kibble],
      purchases: [purchase({ feedTypeId: KIBBLE, quantity: 100, unitCost: { cents: 200 } })],
      animals: [{ id: SMOKEY, zoneIds: [] }],
      days: 10,
    });

    expect(allocations[0]?.quantityByFeedType.get(KIBBLE)).toBeCloseTo(10, 6);
  });

  it("lets one cat's own plan override the shared bowl, and leaves the other on it", () => {
    // §5.1's precedence, which does not stop applying because a plan is
    // shared: a cat on a prescription diet comes off the communal bowl.
    const prescription = plan({
      id: id(71),
      name: "Boots — renal",
      target: "animal",
      targetId: BOOTS,
      alsoFeeds: [],
      portion: "per_head",
      lines: [
        {
          feedTypeId: KIBBLE,
          amount: quantity(0.25, "lb"),
          frequency: "twice_daily",
          timeOfDay: "morning",
        },
      ],
    });

    const allocations = allocateFeedCost({
      plans: [bowl(), prescription],
      feeds: [kibble],
      purchases: [purchase({ feedTypeId: KIBBLE, quantity: 100, unitCost: { cents: 200 } })],
      animals: cats,
      days: 10,
    });

    // Smokey is the only one left on the bowl, so he carries all of it.
    expect(allocations[0]?.quantityByFeedType.get(KIBBLE)).toBeCloseTo(10, 6);
    expect(allocations[1]?.quantityByFeedType.get(KIBBLE)).toBeCloseTo(5, 6);
  });

  it("does not let one shared plan swallow another's count", () => {
    const other = bowl({
      id: id(72),
      name: "The porch cat",
      targetId: id(62),
      alsoFeeds: [],
    });

    const demand = herdDemand({
      plans: [bowl(), other],
      feeds: [kibble],
      animals: [...cats, { id: id(62), zoneIds: [] }],
    });

    // A pound for the barn cats, a pound for the porch cat.
    expect(demand.perDay.get(KIBBLE)).toBeCloseTo(2, 6);
  });
});
