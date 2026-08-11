import { describe, expect, it } from "vitest";

import { quantity, type Ulid } from "@galaxy-farm/core";

import {
  animalsUnderWithdrawal,
  boosterDue,
  healthHistoryFor,
  healthRecordSchema,
  isClearForSale,
  isUnderWithdrawal,
  withdrawalEndDate,
  type HealthRecord,
} from "../src/domain/health-record.js";
import {
  drawDose,
  expiringSoon,
  isExpired,
  medInventorySchema,
  type MedInventory,
} from "../src/domain/med-inventory.js";
import {
  averageDailyGain,
  lifetimeGain,
  unadjusted205DayWeight,
  weightIn,
  weightRecordSchema,
  weightsFor,
  type WeightRecord,
} from "../src/domain/weight-record.js";

/**
 * Health, withdrawal, medicine and weights (spec §5.2).
 *
 * The withdrawal clock is the one derived value here with a legal edge on it:
 * an animal inside a withdrawal period must not enter the food chain. §5.2
 * calls it "critical for beef" and it is the reason these tests are more
 * suspicious than the rest.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");

const health = (over: Partial<HealthRecord> = {}): HealthRecord => ({
  id: id(1),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  animalId: id(2),
  type: "treatment",
  date: new Date("2026-08-01T00:00:00Z"),
  product: "Draxxin",
  withdrawalDays: 18,
  ...over,
});

describe("withdrawalEndDate", () => {
  it("adds the withdrawal to the treatment date", () => {
    expect(withdrawalEndDate(health())).toEqual(new Date("2026-08-19T00:00:00Z"));
  });

  it("distinguishes no withdrawal from a withdrawal of zero", () => {
    // "No withdrawal" and "cleared today" are different sentences on an
    // animal's page, and the difference is whether anyone has to wait.
    expect(withdrawalEndDate(health({ withdrawalDays: undefined }))).toBeUndefined();
    expect(withdrawalEndDate(health({ withdrawalDays: 0 }))).toEqual(
      new Date("2026-08-01T00:00:00Z"),
    );
  });
});

describe("isUnderWithdrawal", () => {
  it("holds the animal until the clearance date and releases it on the day", () => {
    expect(isUnderWithdrawal(health(), new Date("2026-08-18T23:00:00Z"))).toBe(true);
    expect(isUnderWithdrawal(health(), new Date("2026-08-19T00:00:00Z"))).toBe(false);
  });

  it("never holds an animal for a product with no withdrawal", () => {
    expect(isUnderWithdrawal(health({ withdrawalDays: undefined }), AT)).toBe(false);
  });
});

describe("animalsUnderWithdrawal", () => {
  it("reports the latest clearance when an animal was treated twice", () => {
    // Two treatments a week apart clear on the later of the two. Reporting the
    // earlier one would clear an animal that is not clear — the direction of
    // this mistake is the one that matters.
    const first = health({ id: id(3), date: new Date("2026-08-01"), withdrawalDays: 18 });
    const second = health({ id: id(4), date: new Date("2026-08-08"), withdrawalDays: 18 });

    const [status] = animalsUnderWithdrawal([first, second], new Date("2026-08-10"));

    expect(status?.clearsOn).toEqual(new Date("2026-08-26T00:00:00Z"));
  });

  it("does not let a later, shorter withdrawal shorten an earlier longer one", () => {
    const long = health({ id: id(5), date: new Date("2026-08-01"), withdrawalDays: 60 });
    const short = health({ id: id(6), date: new Date("2026-08-08"), withdrawalDays: 3 });

    const [status] = animalsUnderWithdrawal([long, short], new Date("2026-08-10"));

    expect(status?.clearsOn).toEqual(new Date("2026-09-30T00:00:00Z"));
  });

  it("orders the board as a queue, soonest first", () => {
    const later = health({
      id: id(7),
      animalId: id(20),
      date: new Date("2026-08-10"),
      withdrawalDays: 30,
    });
    const sooner = health({
      id: id(8),
      animalId: id(21),
      date: new Date("2026-08-10"),
      withdrawalDays: 5,
    });

    const board = animalsUnderWithdrawal([later, sooner], new Date("2026-08-11"));

    expect(board.map((row) => row.animalId)).toEqual([id(21), id(20)]);
  });

  it("counts the days left, rounding up so a part-day still counts", () => {
    const [status] = animalsUnderWithdrawal([health()], new Date("2026-08-18T13:00:00Z"));
    expect(status?.daysRemaining).toBe(1);
  });

  it("drops an animal off the board once it clears", () => {
    expect(animalsUnderWithdrawal([health()], new Date("2026-09-01"))).toEqual([]);
  });
});

describe("isClearForSale", () => {
  it("refuses an animal inside any withdrawal", () => {
    expect(isClearForSale([health()], id(2), new Date("2026-08-10"))).toBe(false);
  });

  it("clears an animal whose withdrawals have all passed", () => {
    expect(isClearForSale([health()], id(2), new Date("2026-09-01"))).toBe(true);
  });

  it("clears an animal that was never treated", () => {
    expect(isClearForSale([health()], id(99), AT)).toBe(true);
  });
});

describe("boosterDue", () => {
  const shot = health({
    id: id(10),
    type: "vaccination",
    product: "Bovi-Shield Gold",
    date: new Date("2026-08-01"),
    boosterDueOn: new Date("2026-08-22"),
    withdrawalDays: undefined,
  });

  it("raises the booster inside the lead time", () => {
    const due = boosterDue([shot], new Date("2026-08-16"), 7);
    expect(due).toHaveLength(1);
    expect(due[0]?.overdue).toBe(false);
  });

  it("stays quiet while it is still far off", () => {
    expect(boosterDue([shot], new Date("2026-08-01"), 7)).toEqual([]);
  });

  it("marks a missed booster overdue rather than dropping it", () => {
    const due = boosterDue([shot], new Date("2026-09-01"), 7);
    expect(due[0]?.overdue).toBe(true);
  });

  it("treats the second shot itself as completion", () => {
    // There is no separate "done" flag: the booster is a health record. Asking
    // someone to log it twice guarantees the two disagree.
    const second = health({
      id: id(11),
      type: "vaccination",
      product: "Bovi-Shield Gold",
      date: new Date("2026-08-22"),
      withdrawalDays: undefined,
    });

    expect(boosterDue([shot, second], new Date("2026-09-01"), 7)).toEqual([]);
  });

  it("does not accept a different product as the booster", () => {
    const unrelated = health({
      id: id(12),
      type: "vaccination",
      product: "Vision 7",
      date: new Date("2026-08-25"),
      withdrawalDays: undefined,
    });

    expect(boosterDue([shot, unrelated], new Date("2026-09-01"), 7)).toHaveLength(1);
  });
});

describe("healthRecordSchema", () => {
  it("accepts a treatment", () => {
    expect(healthRecordSchema.safeParse(health()).success).toBe(true);
  });

  it("refuses a booster scheduled before the shot", () => {
    const result = healthRecordSchema.safeParse({
      ...health(),
      boosterDueOn: new Date("2026-07-01"),
    });
    expect(result.success).toBe(false);
  });
});

describe("healthHistoryFor", () => {
  it("returns one animal's records, most recent first", () => {
    const older = health({ id: id(13), date: new Date("2026-01-01") });
    const other = health({ id: id(14), animalId: id(88) });

    expect(healthHistoryFor([older, health(), other], id(2)).map((r) => r.id)).toEqual([
      id(1),
      id(13),
    ]);
  });
});

// ---------------------------------------------------------------- medicine

const med = (over: Partial<MedInventory> = {}): MedInventory => ({
  id: id(30),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  product: "Draxxin",
  category: "antibiotic",
  onHand: quantity(250, "ml"),
  expiresOn: new Date("2026-09-01"),
  defaultWithdrawalDays: 18,
  ...over,
});

describe("expiringSoon", () => {
  it("raises a bottle inside the lead time", () => {
    expect(expiringSoon([med()], AT, 30)).toHaveLength(1);
  });

  it("keeps already-expired stock in the list", () => {
    // A bottle that went out of date last month is still in the fridge and
    // still the one somebody reaches for at six in the morning.
    const stale = med({ id: id(31), expiresOn: new Date("2026-07-01") });
    expect(expiringSoon([stale], AT, 30)).toHaveLength(1);
    expect(isExpired(stale, AT)).toBe(true);
  });

  it("ignores stock with no expiry recorded", () => {
    expect(expiringSoon([med({ expiresOn: undefined })], AT, 30)).toEqual([]);
  });

  it("orders soonest first", () => {
    const later = med({ id: id(32), expiresOn: new Date("2026-12-01") });
    expect(expiringSoon([later, med()], AT, 200).map((m) => m.id)).toEqual([id(30), id(32)]);
  });
});

describe("drawDose", () => {
  it("takes the dose off the shelf", () => {
    const result = drawDose(med(), quantity(15, "ml"), AT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.item.onHand).toEqual(quantity(235, "ml"));
  });

  it("refuses to go negative rather than clamping at zero", () => {
    // §4.5 clause 2 names this class of invariant as domain logic. A fridge
    // showing minus two bottles is a fridge nobody trusts, and the honest
    // reading is that the count was wrong before the dose.
    const result = drawDose(med({ onHand: quantity(10, "ml") }), quantity(15, "ml"), AT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/10 ml on hand/);
  });

  it("refuses to draw one unit out of stock held in another", () => {
    const result = drawDose(med(), quantity(1, "dose"), AT);
    expect(result.ok).toBe(false);
  });

  it("refuses a dose of nothing", () => {
    expect(drawDose(med(), quantity(0, "ml"), AT).ok).toBe(false);
  });
});

describe("medInventorySchema", () => {
  it("accepts a bottle", () => {
    expect(medInventorySchema.safeParse(med()).success).toBe(true);
  });
});

// ---------------------------------------------------------------- weights

const weight = (over: Partial<WeightRecord> = {}): WeightRecord => ({
  id: id(40),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  animalId: id(2),
  date: new Date("2026-11-22"),
  weightLb: 78,
  context: "birth",
  ...over,
});

describe("averageDailyGain", () => {
  it("divides the gain by the days between", () => {
    const birth = weight();
    const weaning = weight({
      id: id(41),
      date: new Date("2027-06-15"),
      weightLb: 578,
      context: "weaning",
    });

    // 500 lb over 205 days.
    expect(averageDailyGain(birth, weaning)).toBeCloseTo(500 / 205, 6);
  });

  it("says nothing for two weights taken the same day", () => {
    // "What did she gain per day over zero days" has no answer, and Infinity
    // renders as a very impressive calf.
    expect(averageDailyGain(weight(), weight({ id: id(42), weightLb: 90 }))).toBeUndefined();
  });
});

describe("unadjusted205DayWeight", () => {
  it("projects the weaning weight to 205 days", () => {
    const birth = weight();
    const weaning = weight({
      id: id(43),
      date: new Date("2027-06-15"),
      weightLb: 578,
      context: "weaning",
    });

    expect(unadjusted205DayWeight(birth, weaning)).toBeCloseTo(578, 6);
  });

  it("scales a calf weaned early up to the 205-day figure", () => {
    const birth = weight();
    const early = weight({
      id: id(44),
      date: new Date("2027-05-06"),
      weightLb: 478,
      context: "weaning",
    });

    // 165 days, 400 lb gained → (400/165)*205 + 78.
    expect(unadjusted205DayWeight(birth, early)).toBeCloseTo((400 / 165) * 205 + 78, 6);
  });

  it("says nothing when the two weights share a date", () => {
    expect(unadjusted205DayWeight(weight(), weight({ id: id(45) }))).toBeUndefined();
  });
});

describe("weightsFor and weightIn", () => {
  it("orders oldest first, which is what a growth chart wants", () => {
    const later = weight({ id: id(46), date: new Date("2027-06-15"), context: "weaning" });
    expect(weightsFor([later, weight()], id(2)).map((w) => w.id)).toEqual([id(40), id(46)]);
  });

  it("finds a weight by its context", () => {
    const weaning = weight({ id: id(47), date: new Date("2027-06-15"), context: "weaning" });
    expect(weightIn([weight(), weaning], id(2), "weaning")?.id).toBe(id(47));
    expect(weightIn([weight()], id(2), "yearling")).toBeUndefined();
  });
});

describe("lifetimeGain", () => {
  it("measures first to last rather than averaging the intervals", () => {
    // The intervals are unevenly spaced. Averaging them would weight a
    // fortnight between two chute visits the same as the six months after it.
    const birth = weight();
    const middle = weight({ id: id(48), date: new Date("2026-12-06"), weightLb: 110 });
    const last = weight({ id: id(49), date: new Date("2027-06-15"), weightLb: 578 });

    expect(lifetimeGain([birth, middle, last], id(2))).toBeCloseTo(500 / 205, 6);
  });

  it("says nothing for an animal weighed once", () => {
    expect(lifetimeGain([weight()], id(2))).toBeUndefined();
    expect(lifetimeGain([], id(2))).toBeUndefined();
  });
});

describe("weightRecordSchema", () => {
  it("refuses a weight of zero", () => {
    expect(weightRecordSchema.safeParse({ ...weight(), weightLb: 0 }).success).toBe(false);
  });

  it("accepts a real weight", () => {
    expect(weightRecordSchema.safeParse(weight()).success).toBe(true);
  });
});
