import { describe, expect, it } from "vitest";

import { fromDollars, type Ulid } from "@galaxy-farm/core";

import {
  flockAdjustmentSchema,
  flockSchema,
  headCountOn,
  lossesIn,
  totalBirdsOn,
  type Flock,
  type FlockAdjustment,
} from "../src/domain/flock.js";
import {
  breakdownTotals,
  dispositionTotals,
  eggDispositionSchema,
  eggLogSchema,
  eggTotalsByPeriod,
  eggsOnHand,
  layRate,
  type EggDisposition,
  type EggLog,
} from "../src/domain/eggs.js";

/** Poultry (spec §5.4). */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const flock: Flock = {
  id: id(1),
  ...base,
  name: "Main coop",
  species: "chicken",
  openingCount: 18,
  active: true,
};

const adjustment = (over: Partial<FlockAdjustment> = {}): FlockAdjustment => ({
  id: id(10),
  ...base,
  flockId: id(1),
  reason: "predator",
  quantity: 4,
  occurredOn: new Date("2026-06-15"),
  ...over,
});

describe("headCountOn", () => {
  it("moves the count the right way for each reason", () => {
    const added = adjustment({
      id: id(11),
      reason: "added",
      quantity: 6,
      occurredOn: new Date("2026-07-01"),
    });
    expect(headCountOn(flock, [adjustment(), added], AT)).toBe(20);
  });

  it("answers as of a date, not only as of now", () => {
    // Eggs per bird for last April needs April's headcount. A stored total can
    // only ever answer about today.
    expect(headCountOn(flock, [adjustment()], new Date("2026-05-01"))).toBe(18);
    expect(headCountOn(flock, [adjustment()], new Date("2026-07-01"))).toBe(14);
  });

  it("ignores another flock's adjustments", () => {
    expect(headCountOn(flock, [adjustment({ flockId: id(9) })], AT)).toBe(18);
  });
});

describe("totalBirdsOn", () => {
  const quail: Flock = {
    ...flock,
    id: id(2),
    name: "Quail hutch",
    species: "quail",
    openingCount: 30,
  };

  it("adds every live flock up", () => {
    expect(totalBirdsOn([flock, quail], [adjustment()], AT)).toBe(44);
  });

  it("leaves a retired flock out", () => {
    // Its birds are gone. Counting them would put them in the feed demand and
    // in an eggs-per-bird figure nobody is collecting against.
    expect(totalBirdsOn([flock, { ...quail, active: false }], [adjustment()], AT)).toBe(14);
  });
});

describe("lossesIn", () => {
  it("groups losses by reason, which is what says whether to fix a fence", () => {
    const died = adjustment({ id: id(12), reason: "died", quantity: 1 });
    const sold = adjustment({ id: id(13), reason: "sold", quantity: 2 });
    const bought = adjustment({ id: id(14), reason: "added", quantity: 5 });

    const losses = lossesIn(id(1), [adjustment(), died, sold, bought], {
      from: new Date("2026-06-01"),
      to: new Date("2026-06-30"),
    });

    expect(losses.get("predator")).toBe(4);
    expect(losses.get("died")).toBe(1);
    expect(losses.has("added")).toBe(false);
  });
});

describe("flock schemas", () => {
  it("accepts quail as a value rather than needing a module", () => {
    // §5.4 says so explicitly.
    expect(flockSchema.safeParse({ ...flock, species: "quail" }).success).toBe(true);
  });

  it("refuses an adjustment of zero", () => {
    expect(flockAdjustmentSchema.safeParse({ ...adjustment(), quantity: 0 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------- eggs

const log = (over: Partial<EggLog> = {}): EggLog => ({
  id: id(20),
  ...base,
  flockId: id(1),
  collectedOn: new Date("2026-08-10T08:00:00Z"),
  total: 12,
  breakdown: [],
  ...over,
});

describe("eggLogSchema", () => {
  it("accepts a bare total, which is what a kiosk +1 button produces", () => {
    // §8: logging must be fast. A log that demanded a breakdown is a log
    // nobody fills in.
    expect(eggLogSchema.safeParse(log()).success).toBe(true);
  });

  it("accepts a breakdown that adds up", () => {
    const detailed = log({
      breakdown: [
        { colour: "brown", size: "large", count: 8 },
        { colour: "blue", size: "medium", count: 4 },
      ],
    });

    expect(eggLogSchema.safeParse(detailed).success).toBe(true);
  });

  it("refuses a breakdown that does not add up to the total", () => {
    // One of the two is wrong, and the trends report would quietly use
    // whichever it read first.
    const wrong = log({ breakdown: [{ colour: "brown", size: "large", count: 5 }] });
    expect(eggLogSchema.safeParse(wrong).success).toBe(false);
  });

  it("accepts a day with no eggs", () => {
    expect(eggLogSchema.safeParse(log({ total: 0 })).success).toBe(true);
  });
});

describe("eggTotalsByPeriod", () => {
  const logs = [
    log({ id: id(21), collectedOn: new Date("2026-08-03T08:00:00Z"), total: 10 }),
    log({ id: id(22), collectedOn: new Date("2026-08-04T08:00:00Z"), total: 14 }),
    log({ id: id(23), collectedOn: new Date("2026-09-01T08:00:00Z"), total: 9 }),
  ];

  it("groups by month", () => {
    expect([...eggTotalsByPeriod(logs, "month")]).toEqual([
      ["2026-08", 24],
      ["2026-09", 9],
    ]);
  });

  it("groups by day", () => {
    expect([...eggTotalsByPeriod(logs, "day")].map(([key]) => key)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-09-01",
    ]);
  });

  it("groups by ISO week, so a week means one thing everywhere", () => {
    const weeks = [...eggTotalsByPeriod(logs, "week")];
    expect(weeks[0]?.[0]).toMatch(/^2026-W\d\d$/);
    expect(weeks[0]?.[1]).toBe(24);
  });
});

describe("layRate", () => {
  it("is eggs per bird per day", () => {
    // Two days, eighteen birds, nine eggs a day: half an egg per bird per day.
    const window = { from: new Date("2026-08-03T00:00:00Z"), to: new Date("2026-08-05T00:00:00Z") };
    const logs = [
      log({ id: id(24), collectedOn: new Date("2026-08-03T08:00:00Z"), total: 9 }),
      log({ id: id(25), collectedOn: new Date("2026-08-04T08:00:00Z"), total: 9 }),
    ];

    expect(layRate(logs, 18, window)).toBeCloseTo(0.5, 6);
  });

  it("counts only what was collected inside the window", () => {
    const window = { from: new Date("2026-08-03T00:00:00Z"), to: new Date("2026-08-04T00:00:00Z") };
    const logs = [
      log({ id: id(28), collectedOn: new Date("2026-08-03T08:00:00Z"), total: 9 }),
      log({ id: id(29), collectedOn: new Date("2026-08-09T08:00:00Z"), total: 9 }),
    ];

    expect(layRate(logs, 18, window)).toBeCloseTo(0.5, 6);
  });

  it("says nothing for an empty coop rather than dividing by zero", () => {
    expect(layRate([], 0, { from: AT, to: AT })).toBeUndefined();
  });
});

describe("breakdownTotals", () => {
  it("adds up by colour and by size", () => {
    const logs = [
      log({
        id: id(26),
        breakdown: [
          { colour: "brown", size: "large", count: 8 },
          { colour: "blue", size: "medium", count: 4 },
        ],
      }),
      log({ id: id(27), total: 6, breakdown: [{ colour: "brown", size: "medium", count: 6 }] }),
    ];

    const { byColour, bySize } = breakdownTotals(logs);

    expect(byColour.get("brown")).toBe(14);
    expect(bySize.get("medium")).toBe(10);
  });
});

const disposition = (over: Partial<EggDisposition> = {}): EggDisposition => ({
  id: id(40),
  ...base,
  disposedOn: new Date("2026-08-10T18:00:00Z"),
  quantity: 12,
  kind: "kept",
  ...over,
});

describe("eggsOnHand", () => {
  it("is what was collected, less what left the basket", () => {
    const logs = [log({ id: id(41), total: 24 })];
    expect(eggsOnHand(logs, [disposition()], AT)).toBe(12);
  });

  it("counts nothing that has not happened yet", () => {
    // The basket on the first of the month does not hold eggs collected on the
    // tenth, and a trend read against a past date would say it did.
    const logs = [log({ id: id(42), collectedOn: new Date("2026-08-10T08:00:00Z"), total: 24 })];
    expect(eggsOnHand(logs, [], new Date("2026-08-01"))).toBe(0);
  });

  it("goes negative rather than hiding a disagreement behind a zero", () => {
    expect(eggsOnHand([], [disposition()], AT)).toBe(-12);
  });
});

describe("dispositionTotals", () => {
  it("splits by kind and adds up only what was sold", () => {
    const entries = [
      disposition(),
      disposition({ id: id(43), kind: "given", quantity: 6 }),
      disposition({ id: id(44), kind: "sold", quantity: 24, price: fromDollars(6) }),
      disposition({ id: id(45), kind: "sold", quantity: 12, price: fromDollars(3) }),
    ];

    const { byKind, revenue } = dispositionTotals(entries);

    expect(byKind.get("kept")).toBe(12);
    expect(byKind.get("sold")).toBe(36);
    expect(revenue).toEqual(fromDollars(9));
  });

  it("takes a window, so this month's takings are not last year's", () => {
    const entries = [
      disposition({ id: id(46), kind: "sold", quantity: 12, price: fromDollars(5) }),
      disposition({
        id: id(47),
        kind: "sold",
        quantity: 12,
        price: fromDollars(5),
        disposedOn: new Date("2025-08-10T18:00:00Z"),
      }),
    ];

    const { byKind, revenue } = dispositionTotals(entries, {
      from: new Date("2026-08-01"),
      to: new Date("2026-08-31"),
    });

    expect(byKind.get("sold")).toBe(12);
    expect(revenue).toEqual(fromDollars(5));
  });
});

describe("eggDispositionSchema", () => {
  it("accepts a sale with a price", () => {
    const sold = {
      id: id(30),
      ...base,
      disposedOn: AT,
      quantity: 24,
      kind: "sold" as const,
      price: fromDollars(6),
    };

    expect(eggDispositionSchema.safeParse(sold).success).toBe(true);
  });

  it("refuses a price on eggs that were given away", () => {
    const given = {
      id: id(31),
      ...base,
      disposedOn: AT,
      quantity: 12,
      kind: "given" as const,
      price: fromDollars(3),
    };

    expect(eggDispositionSchema.safeParse(given).success).toBe(false);
  });
});
