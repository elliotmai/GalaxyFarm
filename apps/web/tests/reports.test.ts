import { describe, expect, it } from "vitest";

import type {
  Animal,
  FeedingPlan,
  PurchaseCandidate,
  RoadmapItem,
  Ulid,
  ZoneAssignment,
} from "@galaxy-farm/core";
import type {
  AcquisitionRecord,
  HealthRecord,
  ProcessingRecord,
  SaleRecord,
} from "@galaxy-farm/module-cattle";
import type { FeedPurchase, FeedType } from "@galaxy-farm/module-feed";

import {
  capitalPlan,
  daysBetween,
  feedSpend,
  herdGrowth,
  herdProfitAndLoss,
  operatingCost,
  processingYields,
  zoneNamesFor,
  type ReportRange,
} from "../lib/reports.js";

/**
 * The reports suite (spec §6).
 *
 * A report is read once and acted on, so the failure that matters is not a
 * crash — it is a number that looks right. Every test below is about one of
 * those: an unpriced record counted as free, a beef that went in the freezer
 * reported as a bad sale, a listing already passed on still padding a budget.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const on = (day: number) => new Date(Date.UTC(2026, 5, day, 12));
const RANGE: ReportRange = { from: on(1), to: on(30) };

const DOLLY = id(1);
const CHIEF = id(2);
const HAY = id(10);

const animal = (overrides: Partial<Animal> & Pick<Animal, "id">): Animal =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    species: "cattle",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
    ...overrides,
  }) as Animal;

const feed = (overrides: Partial<FeedType> & Pick<FeedType, "id">): FeedType =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    name: "Round bale hay",
    category: "hay",
    unit: "round_bale",
    reorderLeadDays: 3,
    active: true,
    ...overrides,
  }) as FeedType;

const purchase = (overrides: Partial<FeedPurchase> & Pick<FeedPurchase, "id">): FeedPurchase =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    feedTypeId: HAY,
    quantity: 4,
    unitCost: { cents: 8_500 },
    purchasedOn: on(5),
    ...overrides,
  }) as FeedPurchase;

const processing = (
  overrides: Partial<ProcessingRecord> & Pick<ProcessingRecord, "id">,
): ProcessingRecord =>
  ({
    propertyId: id(0),
    createdAt: on(1),
    updatedAt: on(1),
    animalId: CHIEF,
    deliveredOn: on(10),
    cutLines: [],
    ...overrides,
  }) as ProcessingRecord;

const NO_PNL_SOURCES = {
  animals: [] as Animal[],
  acquisitions: [] as AcquisitionRecord[],
  sales: [] as SaleRecord[],
  health: [] as HealthRecord[],
  processing: [] as ProcessingRecord[],
  plans: [] as FeedingPlan[],
  purchases: [] as FeedPurchase[],
  assignments: [] as ZoneAssignment[],
};

describe("daysBetween", () => {
  it("never returns zero, so nothing divides by it", () => {
    expect(daysBetween({ from: on(1), to: on(1) })).toBe(1);
    expect(daysBetween(RANGE)).toBe(29);
  });
});

describe("herdProfitAndLoss", () => {
  it("nets what an animal cost against what it brought", () => {
    const report = herdProfitAndLoss(
      {
        ...NO_PNL_SOURCES,
        animals: [animal({ id: DOLLY, name: "Dolly" })],
        acquisitions: [
          {
            id: id(20),
            animalId: DOLLY,
            date: on(2),
            price: { cents: 250_000 },
          } as AcquisitionRecord,
        ],
        sales: [
          { id: id(21), animalId: DOLLY, date: on(20), price: { cents: 400_000 } } as SaleRecord,
        ],
      },
      RANGE,
    );

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.name).toBe("Dolly");
    expect(report.rollup.net).toEqual({ cents: 150_000 });
    expect(report.rollup.costPerHead).toEqual({ cents: 250_000 });
  });

  it("counts only what happened inside the window", () => {
    // A report headed "June" that quietly included May's purchase is the
    // kind of number somebody makes a decision on and cannot reproduce.
    const report = herdProfitAndLoss(
      {
        ...NO_PNL_SOURCES,
        animals: [animal({ id: DOLLY, name: "Dolly" })],
        acquisitions: [
          {
            id: id(20),
            animalId: DOLLY,
            date: new Date(Date.UTC(2026, 4, 20)),
            price: { cents: 250_000 },
          } as AcquisitionRecord,
        ],
      },
      RANGE,
    );

    expect(report.rollup.totalCost).toEqual({ cents: 0 });
  });

  it("leaves the flock and the pets out of a herd report", () => {
    const report = herdProfitAndLoss(
      {
        ...NO_PNL_SOURCES,
        animals: [
          animal({ id: DOLLY, name: "Dolly" }),
          animal({ id: id(3), name: "Rusty", species: "dog" }),
        ],
      },
      RANGE,
    );

    expect(report.rows.map((row) => row.name)).toEqual(["Dolly"]);
  });

  it("puts the worst animal first, which is what the report is opened for", () => {
    const report = herdProfitAndLoss(
      {
        ...NO_PNL_SOURCES,
        animals: [animal({ id: DOLLY, name: "Dolly" }), animal({ id: CHIEF, name: "Chief" })],
        sales: [
          { id: id(21), animalId: DOLLY, date: on(20), price: { cents: 400_000 } } as SaleRecord,
        ],
        acquisitions: [
          {
            id: id(22),
            animalId: CHIEF,
            date: on(2),
            price: { cents: 300_000 },
          } as AcquisitionRecord,
        ],
      },
      RANGE,
    );

    expect(report.rows.map((row) => row.name)).toEqual(["Chief", "Dolly"]);
  });
});

describe("feedSpend", () => {
  it("totals purchases per feed and works out what a unit averaged", () => {
    const rows = feedSpend(
      [
        purchase({ id: id(30), quantity: 4, unitCost: { cents: 8_500 } }),
        purchase({ id: id(31), quantity: 6, unitCost: { cents: 9_000 } }),
      ],
      [feed({ id: HAY, estWeightLbPerUnit: 1_000 })],
      RANGE,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purchases: 2,
      quantity: 10,
      spend: { cents: 4 * 8_500 + 6 * 9_000 },
      pounds: 10_000,
    });
    expect(rows[0]?.averageUnitCost).toEqual({ cents: 8_800 });
  });

  it("leaves the pounds off a feed that does not know what a unit weighs", () => {
    // A made-up weight per unit propagates into a run-out date somebody
    // drives to town on.
    const rows = feedSpend([purchase({ id: id(30) })], [feed({ id: HAY })], RANGE);

    expect(rows[0]?.pounds).toBeUndefined();
  });

  it("still reports a purchase whose feed has been deleted", () => {
    const rows = feedSpend([purchase({ id: id(30) })], [], RANGE);

    expect(rows[0]?.name).toBe("A feed since deleted");
    expect(rows[0]?.spend).toEqual({ cents: 34_000 });
  });

  it("leaves out purchases outside the window", () => {
    expect(feedSpend([purchase({ id: id(30), purchasedOn: on(40) })], [], RANGE)).toEqual([]);
  });

  it("puts the biggest spend first", () => {
    const rows = feedSpend(
      [
        purchase({ id: id(30), feedTypeId: HAY, quantity: 1, unitCost: { cents: 100 } }),
        purchase({ id: id(31), feedTypeId: id(11), quantity: 1, unitCost: { cents: 900 } }),
      ],
      [feed({ id: HAY }), feed({ id: id(11), name: "Cubes" })],
      RANGE,
    );

    expect(rows.map((row) => row.name)).toEqual(["Cubes", "Round bale hay"]);
  });
});

describe("processingYields", () => {
  it("reports dressing percentage and what a pound actually realised", () => {
    const rows = processingYields(
      [
        processing({
          id: id(40),
          liveScaleWeightLb: 1_200,
          hangingWeightLb: 744,
          cutLines: [
            { cut: "Ribeye", pounds: 40, disposition: "sold", pricePerLb: { cents: 1_800 } },
            { cut: "Ground", pounds: 160, disposition: "sold", pricePerLb: { cents: 700 } },
            { cut: "Brisket", pounds: 20, disposition: "kept" },
          ],
        }),
      ],
      [animal({ id: CHIEF, name: "Chief" })],
      RANGE,
    );

    expect(rows[0]?.dressingPercent).toBeCloseTo(62, 5);
    expect(rows[0]?.poundsSold).toBe(200);
    expect(rows[0]?.poundsKept).toBe(20);
    expect(rows[0]?.revenue).toEqual({ cents: 40 * 1_800 + 160 * 700 });
    expect(rows[0]?.pricePerLbSold).toEqual({ cents: Math.round((40 * 1800 + 160 * 700) / 200) });
  });

  it("does not report $0/lb on a beef that went entirely in the freezer", () => {
    // Dividing by nothing would read as a bad sale rather than as no sale.
    const rows = processingYields(
      [
        processing({
          id: id(40),
          cutLines: [{ cut: "Everything", pounds: 400, disposition: "kept" }],
        }),
      ],
      [],
      RANGE,
    );

    expect(rows[0]?.pricePerLbSold).toBeUndefined();
    expect(rows[0]?.revenue).toEqual({ cents: 0 });
  });

  it("leaves the dressing percentage blank when a weight is missing", () => {
    const rows = processingYields([processing({ id: id(40), hangingWeightLb: 700 })], [], RANGE);

    expect(rows[0]?.dressingPercent).toBeUndefined();
  });
});

describe("herdGrowth", () => {
  const milestone = (overrides: Partial<RoadmapItem> & Pick<RoadmapItem, "id" | "title">) =>
    ({
      propertyId: id(0),
      createdAt: on(1),
      updatedAt: on(1),
      domain: "cattle",
      type: "milestone",
      priority: "want",
      status: "open",
      ...overrides,
    }) as RoadmapItem;

  it("reads the target out of the milestone and compares it to the herd", () => {
    const rows = herdGrowth(
      [animal({ id: DOLLY, name: "Dolly" }), animal({ id: CHIEF, name: "Chief" })],
      [
        milestone({
          id: id(50),
          title: "Reach 20 head",
          targetDate: new Date(Date.UTC(2030, 0, 1)),
        }),
      ],
      on(15),
    );

    expect(rows[0]).toMatchObject({ year: 2030, target: 20, actual: 2, onTrack: false });
  });

  it("still lists a milestone phrased in words, with no target", () => {
    const rows = herdGrowth(
      [],
      [
        milestone({
          id: id(50),
          title: "A cow herd worth showing",
          targetDate: new Date(Date.UTC(2029, 0, 1)),
        }),
      ],
      on(15),
    );

    expect(rows[0]?.target).toBeUndefined();
    expect(rows[0]?.title).toBe("A cow herd worth showing");
  });

  it("leaves out another domain's milestones", () => {
    expect(
      herdGrowth(
        [],
        [
          milestone({
            id: id(50),
            title: "Reach 3 horses",
            domain: "horses",
            targetDate: new Date(Date.UTC(2030, 0, 1)),
          }),
        ],
        on(15),
      ),
    ).toEqual([]);
  });
});

describe("capitalPlan", () => {
  const want = (overrides: Partial<RoadmapItem> & Pick<RoadmapItem, "id" | "title">) =>
    ({
      propertyId: id(0),
      createdAt: on(1),
      updatedAt: on(1),
      domain: "equipment",
      type: "wishlist",
      priority: "need",
      status: "open",
      ...overrides,
    }) as RoadmapItem;

  const candidate = (
    overrides: Partial<PurchaseCandidate> & Pick<PurchaseCandidate, "id" | "title">,
  ) =>
    ({
      propertyId: id(0),
      createdAt: on(1),
      updatedAt: on(1),
      domain: "equipment",
      status: "watching",
      askingPrice: { cents: 3_000_000 },
      additionalCosts: [],
      firstSeen: on(2),
      photoKeys: [],
      pros: [],
      cons: [],
      ...overrides,
    }) as PurchaseCandidate;

  it("compares on total acquisition cost, never on the sticker price", () => {
    // Hauling a tractor 300 miles and replacing its tyres is real money, and
    // it is what decides between two listings.
    const rows = capitalPlan(
      [want({ id: id(60), title: "Truck", budgetEstimate: { cents: 3_200_000 } })],
      [
        candidate({
          id: id(61),
          title: "2018 F-250",
          roadmapItemId: id(60),
          askingPrice: { cents: 3_100_000 },
          additionalCosts: [{ label: "Hauling", amount: { cents: 250_000 } }],
        }),
      ],
    );

    expect(rows[0]?.best).toEqual({ cents: 3_350_000 });
    expect(rows[0]?.overBudget).toBe(true);
  });

  it("leaves out a listing already passed on", () => {
    const rows = capitalPlan(
      [want({ id: id(60), title: "Truck" })],
      [
        candidate({ id: id(61), title: "Gone one", roadmapItemId: id(60), status: "passed" }),
        candidate({ id: id(62), title: "Live one", roadmapItemId: id(60) }),
      ],
    );

    expect(rows[0]?.candidates).toBe(1);
  });

  it("leaves out a want already achieved", () => {
    expect(capitalPlan([want({ id: id(60), title: "Truck", status: "achieved" })], [])).toEqual([]);
  });

  it("is not over budget when nothing has been found yet", () => {
    const rows = capitalPlan(
      [want({ id: id(60), title: "Truck", budgetEstimate: { cents: 100 } })],
      [],
    );

    expect(rows[0]).toMatchObject({ candidates: 0, overBudget: false });
    expect(rows[0]?.best).toBeUndefined();
  });

  it("puts needs before wants", () => {
    const rows = capitalPlan(
      [
        want({ id: id(60), title: "Someday thing", priority: "someday" }),
        want({ id: id(61), title: "Need thing", priority: "need" }),
        want({ id: id(62), title: "Want thing", priority: "want" }),
      ],
      [],
    );

    expect(rows.map((row) => row.title)).toEqual(["Need thing", "Want thing", "Someday thing"]);
  });
});

describe("operatingCost", () => {
  it("counts what it could not price rather than treating it as free", () => {
    const lines = operatingCost(
      {
        purchases: [purchase({ id: id(30), quantity: 2, unitCost: { cents: 5_000 } })],
        health: [
          { id: id(40), animalId: DOLLY, date: on(6), cost: { cents: 4_200 } } as HealthRecord,
          { id: id(41), animalId: DOLLY, date: on(7) } as HealthRecord,
        ],
        acquisitions: [],
        processing: [],
        pastureCare: [],
      },
      RANGE,
    );

    expect(lines).toEqual([
      { category: "Feed", spend: { cents: 10_000 }, records: 1, unpriced: 0 },
      { category: "Health and medicine", spend: { cents: 4_200 }, records: 2, unpriced: 1 },
    ]);
  });

  it("leaves out a category with nothing in the window at all", () => {
    const lines = operatingCost(
      {
        purchases: [],
        health: [],
        acquisitions: [],
        processing: [],
        pastureCare: [{ performedOn: on(9), cost: { cents: 12_000 } }],
      },
      RANGE,
    );

    expect(lines.map((line) => line.category)).toEqual(["Pasture care"]);
  });
});

describe("zoneNamesFor", () => {
  it("names the pens an animal is standing in now", () => {
    const names = zoneNamesFor(
      DOLLY,
      [
        { id: id(70), animalId: DOLLY, zoneId: id(80), periodFrom: on(1) } as ZoneAssignment,
        {
          id: id(71),
          animalId: DOLLY,
          zoneId: id(81),
          periodFrom: on(1),
          periodTo: on(5),
        } as ZoneAssignment,
      ],
      [
        { id: id(80), name: "North Trap" },
        { id: id(81), name: "Barn" },
      ] as never,
      on(15),
    );

    expect(names).toEqual(["North Trap"]);
  });
});
