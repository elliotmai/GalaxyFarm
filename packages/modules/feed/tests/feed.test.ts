import { describe, expect, it } from "vitest";

import { fromDollars, quantity, type FeedingPlan, type Ulid } from "@galaxy-farm/core";

import {
  categoriesFor,
  feedTypeSchema,
  poundsOf,
  roleOf,
  suits,
  type FeedType,
} from "../src/domain/feed-type.js";
import {
  feedConsumptionSchema,
  feedCost,
  feedPurchaseSchema,
  lastReconciledOn,
  onHand,
  plannedConsumption,
  projectFeed,
  purchaseTotal,
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
    const counted = used({ kind: "correction", quantity: 9.5, usedOn: new Date("2026-10-30") });
    const projection = projectFeed(hay, [purchase()], [counted], demand, AT);

    expect(projection.reconciledOn).toEqual(new Date("2026-10-30"));
    // Nine and a half counted, then two and a half days at half a bale.
    expect(projection.onHand).toBeCloseTo(8.25, 5);
    expect(projection.runsOutOn).toEqual(new Date("2026-11-17T12:00:00Z"));
    expect(projection.orderBy).toEqual(new Date("2026-11-10T12:00:00Z"));
    expect(projection.orderNow).toBe(false);
  });

  it("says order now once the lead time has been reached", () => {
    const counted = used({ kind: "correction", quantity: 9.5, usedOn: new Date("2026-10-30") });
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

  it("accept a purchase with no price — the bill can come later", () => {
    expect(feedPurchaseSchema.safeParse({ ...purchase(), unitCost: undefined }).success).toBe(true);
  });

  it("accept a count of zero, which is an empty shed, but no negative count", () => {
    const empty = used({ kind: "correction", quantity: 0 });
    expect(feedConsumptionSchema.safeParse(empty).success).toBe(true);
    expect(feedConsumptionSchema.safeParse({ ...empty, quantity: -1 }).success).toBe(false);
  });
});

describe("a count of the shed", () => {
  const count = (over: Partial<FeedConsumption> = {}) =>
    used({ id: id(25), kind: "correction", quantity: 4, usedOn: new Date("2026-10-20"), ...over });

  it("is what is there — the purchases and entries before it are already in it", () => {
    const extra = used({ usedOn: new Date("2026-10-10") });
    expect(onHand(HAY, [purchase()], [extra, count()])).toBe(4);
  });

  it("adds what was bought after it and takes off what was logged after it", () => {
    const later = purchase({ id: id(11), quantity: 6, purchasedOn: new Date("2026-10-25") });
    const torn = used({ id: id(26), quantity: 1, usedOn: new Date("2026-10-26") });
    expect(onHand(HAY, [purchase(), later], [count(), torn])).toBe(9);
  });

  it("resolves a purchase on the count's own day by which was written first", () => {
    const sameDay = new Date("2026-10-20");
    const before = purchase({ id: id(11), quantity: 6, purchasedOn: sameDay });
    const after = purchase({
      id: id(12),
      quantity: 6,
      purchasedOn: sameDay,
      createdAt: new Date(AT.getTime() + 1_000),
    });
    expect(onHand(HAY, [before], [count()])).toBe(4);
    expect(onHand(HAY, [after], [count()])).toBe(10);
  });

  it("takes the latest count, and a count of zero empties the shed", () => {
    const earlier = count({ id: id(27), quantity: 9, usedOn: new Date("2026-10-05") });
    expect(onHand(HAY, [purchase()], [count({ quantity: 0 }), earlier])).toBe(0);
  });
});

describe("a purchase with no price", () => {
  const unpriced = purchase({ id: id(13), quantity: 5, unitCost: undefined });

  it("still counts toward what is in the shed", () => {
    expect(onHand(HAY, [purchase(), unpriced], [])).toBe(15);
  });

  it("has no total, rather than a total of nothing", () => {
    expect(purchaseTotal(unpriced)).toBeUndefined();
    expect(purchaseTotal(purchase())).toEqual(fromDollars(850));
  });

  it("is left out of the average and marks the cost incomplete", () => {
    expect(feedCost(HAY, [purchase(), unpriced])).toEqual({
      average: fromDollars(85),
      complete: false,
    });
    expect(feedCost(HAY, [unpriced])).toEqual({ average: undefined, complete: false });
    expect(feedCost(HAY, [purchase()])).toEqual({ average: fromDollars(85), complete: true });
  });

  it("leaves the cost a head incomplete, and never prices the feed at $0", () => {
    const zonePlan: FeedingPlan = {
      id: id(39),
      ...base,
      name: "Pen hay",
      species: "cattle",
      animalIds: [id(50)],
      flockIds: [],
      portion: "each",
      active: true,
      lines: [
        {
          feedTypeId: HAY,
          amount: quantity(0.25, "round_bale"),
          frequency: "once_daily",
          timeOfDay: "morning",
        },
      ],
    };
    const cow = { id: id(50) };

    const none = allocateFeedCost({
      plans: [zonePlan],
      purchases: [unpriced],
      animals: [cow],
      days: 30,
    });
    expect(none[0]?.costComplete).toBe(false);
    expect(none[0]?.cost).toEqual({ cents: 0 });

    const some = allocateFeedCost({
      plans: [zonePlan],
      purchases: [purchase(), unpriced],
      animals: [cow],
      days: 30,
    });
    // Priced at what the priced load cost, and still flagged.
    expect(some[0]?.cost).toEqual(fromDollars(637.5));
    expect(some[0]?.costComplete).toBe(false);
  });
});

// ---------------------------------------------------------------- allocation

const COWS = [id(50), id(51), id(52), id(53)];

const plan = (over: Partial<FeedingPlan> = {}): FeedingPlan => ({
  id: id(30),
  ...base,
  name: "Pasture cows",
  species: "cattle",
  animalIds: COWS,
  flockIds: [],
  portion: "each",
  active: true,
  lines: [
    {
      feedTypeId: HAY,
      amount: quantity(0.25, "round_bale"),
      frequency: "once_daily",
      timeOfDay: "morning",
      receptacle: "hay_ring",
    },
  ],
  ...over,
});

const onFarm = (...ids: Ulid[]) => ids.map((animalId) => ({ id: animalId }));

describe("herdDemand", () => {
  it("counts an 'each' amount once per head on the place", () => {
    const { perDay } = herdDemand({ plans: [plan()], feeds: [hay], animals: onFarm(...COWS) });
    expect(perDay.get(HAY)).toBeCloseTo(1, 6);
  });

  it("stops counting an animal the day it leaves, even while it is still named", () => {
    const { perDay } = herdDemand({
      plans: [plan()],
      feeds: [hay],
      animals: onFarm(id(50), id(51)),
    });
    expect(perDay.get(HAY)).toBeCloseTo(0.5, 6);
  });

  it("counts a 'total' amount once, however many share it", () => {
    const { perDay } = herdDemand({
      plans: [plan({ portion: "total" })],
      feeds: [hay],
      animals: onFarm(...COWS),
    });
    expect(perDay.get(HAY)).toBeCloseTo(0.25, 6);
  });

  it("sums an animal's plans rather than letting one replace another", () => {
    // A base ration and a supplement plan for one cow: both go out.
    const base = plan({ animalIds: [id(50)] });
    const extra = plan({ id: id(31), animalIds: [id(50)] });
    const { perDay } = herdDemand({ plans: [base, extra], feeds: [hay], animals: onFarm(id(50)) });
    expect(perDay.get(HAY)).toBeCloseTo(0.5, 6);
  });

  it("feeds a flock by its headcount", () => {
    const LAYER = id(5);
    const layer: FeedType = {
      ...hay,
      id: LAYER,
      name: "Layer pellets",
      category: "layer_feed",
      unit: "lb",
    };
    const hens = plan({
      species: "chicken",
      animalIds: [],
      flockIds: [id(70)],
      lines: [
        {
          feedTypeId: LAYER,
          amount: quantity(0.25, "lb"),
          frequency: "once_daily",
          timeOfDay: "morning",
        },
      ],
    });
    const { perDay } = herdDemand({
      plans: [hens],
      feeds: [layer],
      animals: [],
      flocks: [{ id: id(70), heads: 12 }],
    });
    expect(perDay.get(LAYER)).toBeCloseTo(3, 6);
  });

  it("restates a ration in the unit its feed is counted in", () => {
    // 550 lb a day of a 1,100 lb bale is half a bale.
    const pounds = plan({
      animalIds: [id(50)],
      lines: [
        {
          feedTypeId: HAY,
          amount: quantity(550, "lb"),
          frequency: "once_daily",
          timeOfDay: "morning",
        },
      ],
    });
    const { perDay } = herdDemand({ plans: [pounds], feeds: [hay], animals: onFarm(id(50)) });
    expect(perDay.get(HAY)).toBeCloseTo(0.5, 6);
  });

  it("names a ration it cannot convert rather than counting it wrongly", () => {
    const { estWeightLbPerUnit: _w, ...noWeight } = hay;
    const scoops = plan({
      animalIds: [id(50)],
      lines: [
        {
          feedTypeId: HAY,
          amount: quantity(2, "scoop"),
          frequency: "once_daily",
          timeOfDay: "morning",
        },
      ],
    });
    const { perDay, unconvertible } = herdDemand({
      plans: [scoops],
      feeds: [noWeight as FeedType],
      animals: onFarm(id(50)),
    });
    expect(perDay.has(HAY)).toBe(false);
    expect(unconvertible).toEqual([HAY]);
  });

  it("takes a ration for a feed that has left the catalogue at face value", () => {
    const { perDay } = herdDemand({ plans: [plan()], feeds: [], animals: onFarm(...COWS) });
    expect(perDay.get(HAY)).toBeCloseTo(1, 6);
  });
});

describe("allocateFeedCost", () => {
  const priced = purchase({ unitCost: fromDollars(80) });

  it("charges each head its own 'each' amount", () => {
    const allocations = allocateFeedCost({
      plans: [plan()],
      purchases: [priced],
      feeds: [hay],
      animals: onFarm(...COWS),
      days: 4,
    });
    // A quarter bale a day for four days is one bale, at $80.
    expect(allocations.map((a) => a.cost)).toEqual(COWS.map(() => fromDollars(80)));
    expect(costPerHead(allocations)).toEqual(fromDollars(80));
  });

  it("splits a 'total' amount between the heads still on the place", () => {
    const allocations = allocateFeedCost({
      plans: [plan({ portion: "total" })],
      purchases: [priced],
      feeds: [hay],
      animals: onFarm(id(50), id(51)),
      days: 4,
    });
    // One bale over four days, shared by two: half a bale each.
    expect(allocationFor(allocations, id(50))?.cost).toEqual(fromDollars(40));
    expect(allocationFor(allocations, id(51))?.cost).toEqual(fromDollars(40));
  });

  it("charges a cow on a second plan for both", () => {
    const allocations = allocateFeedCost({
      plans: [plan(), plan({ id: id(31), animalIds: [id(50)] })],
      purchases: [priced],
      feeds: [hay],
      animals: onFarm(...COWS),
      days: 4,
    });
    expect(allocationFor(allocations, id(50))?.cost).toEqual(fromDollars(160));
    expect(allocationFor(allocations, id(51))?.cost).toEqual(fromDollars(80));
  });

  it("says the cost is incomplete when a feed has never been bought", () => {
    const [allocation] = allocateFeedCost({
      plans: [plan({ animalIds: [id(50)] })],
      purchases: [],
      feeds: [hay],
      animals: onFarm(id(50)),
      days: 7,
    });
    expect(allocation?.costComplete).toBe(false);
    expect(allocation?.cost).toEqual({ cents: 0 });
  });

  it("prices a ration in the unit the feed was bought by", () => {
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
    // Nine scoops a day is half a bag, so a week is three and a half bags at
    // $18 — not nine bags a day at $18, which is the bill a dropped unit makes.
    const [allocation] = allocateFeedCost({
      plans: [
        plan({
          animalIds: [id(50)],
          lines: [
            {
              feedTypeId: CUBES,
              amount: quantity(9, "scoop"),
              frequency: "once_daily",
              timeOfDay: "morning",
            },
          ],
        }),
      ],
      purchases: [
        purchase({ id: id(15), feedTypeId: CUBES, quantity: 20, unitCost: fromDollars(18) }),
      ],
      feeds: [cubes],
      animals: onFarm(id(50)),
      days: 7,
    });
    expect(allocation?.quantityByFeedType.get(CUBES)).toBeCloseTo(3.5, 6);
    expect(allocation?.cost.cents).toBe(Math.round(3.5 * fromDollars(18).cents));
  });
});

describe("costPerHead", () => {
  it("averages the allocations, and is zero for nobody", () => {
    expect(costPerHead([])).toEqual({ cents: 0 });
  });
});

describe("knowing who eats a feed", () => {
  it("offers each species its own feeds, and supplements to everybody", () => {
    expect(categoriesFor("reptile")).toEqual(
      expect.arrayContaining(["live_insects", "frozen_prey", "calcium_dust", "supplement"]),
    );
    expect(categoriesFor("reptile")).not.toContain("hay");
    expect(categoriesFor("dog")).toEqual(expect.arrayContaining(["dry_food", "wet_food", "treat"]));
    expect(categoriesFor("dog")).not.toContain("live_insects");
    expect(categoriesFor("chicken")).toEqual(
      expect.arrayContaining(["layer_feed", "grit", "oyster_shell", "scratch"]),
    );
    expect(suits("hay", "cattle")).toBe(true);
    expect(suits("hay", "cat")).toBe(false);
    expect(suits("supplement", "reptile")).toBe(true);
  });

  it("says whether a feed is a feed, a supplement or a treat", () => {
    expect(roleOf({ category: "calcium_dust" })).toBe("supplement");
    expect(roleOf({ category: "scratch" })).toBe("treat");
    expect(roleOf({ category: "dry_food" })).toBe("feed");
  });
});
