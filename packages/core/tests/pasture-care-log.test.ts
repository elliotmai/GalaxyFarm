import { describe, expect, it } from "vitest";

import {
  careHistoryFor,
  costPerAcre,
  lastPerformed,
  pastureCareLogSchema,
  type PastureCareLog,
} from "../src/entities/pasture-care-log.js";
import { fromDollars } from "../src/value-objects/money.js";
import { quantity } from "../src/value-objects/quantity.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * Pasture care (spec §5.1, added v0.7).
 *
 * The reminders that matter here are seasonal — overseed rye every fall — and
 * they are answerable only against the date it was last done.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");

const log = (over: Partial<PastureCareLog> = {}): PastureCareLog => ({
  id: id(1),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  zoneId: id(2),
  action: "overseed",
  performedOn: new Date("2025-10-04T00:00:00Z"),
  product: "Winter rye",
  ratePerAcre: quantity(50, "lb"),
  acres: 12,
  cost: fromDollars(420),
  ...over,
});

describe("costPerAcre", () => {
  it("divides the cost across the acres actually treated", () => {
    expect(costPerAcre(log())).toEqual(fromDollars(35));
  });

  it("says nothing rather than zero when the cost was never recorded", () => {
    // A mow with no cost entered cost an unknown amount, not nothing. Averaging
    // a zero into per-pasture cost history understates every total downstream.
    expect(costPerAcre(log({ cost: undefined }))).toBeUndefined();
  });

  it("says nothing when the acreage is missing or absurd", () => {
    expect(costPerAcre(log({ acres: undefined }))).toBeUndefined();
    expect(costPerAcre(log({ acres: 0 }))).toBeUndefined();
  });
});

describe("careHistoryFor", () => {
  const spring = log({ id: id(3), action: "fertilize", performedOn: new Date("2026-03-15") });
  const fall = log({ id: id(4), action: "overseed", performedOn: new Date("2025-10-04") });
  const other = log({ id: id(5), zoneId: id(9), performedOn: new Date("2026-06-01") });

  it("returns one zone's history, newest first", () => {
    expect(careHistoryFor([fall, spring, other], id(2)).map((l) => l.id)).toEqual([id(3), id(4)]);
  });

  it("does not leak another pasture's work into this one's history", () => {
    expect(careHistoryFor([other], id(2))).toEqual([]);
  });
});

describe("lastPerformed", () => {
  it("finds the most recent instance of one action", () => {
    const older = log({ id: id(6), performedOn: new Date("2024-10-01") });
    const newer = log({ id: id(7), performedOn: new Date("2025-10-04") });

    expect(lastPerformed([older, newer], id(2), "overseed")).toEqual(new Date("2025-10-04"));
  });

  it("does not answer with a different action's date", () => {
    // "When did we last overseed" answered with the date we last mowed is worse
    // than no answer: it reads as done and skips the reminder.
    const mowed = log({ id: id(8), action: "mow", performedOn: new Date("2026-07-01") });

    expect(lastPerformed([mowed], id(2), "overseed")).toBeUndefined();
  });
});

describe("pastureCareLogSchema", () => {
  it("accepts a full entry", () => {
    expect(pastureCareLogSchema.safeParse(log()).success).toBe(true);
  });

  it("accepts a bare mow — no product, no rate, no cost", () => {
    // Most entries will be this. Demanding a rate for a mow would train people
    // to type a fake one.
    const bare = pastureCareLogSchema.safeParse({
      ...log(),
      action: "mow",
      product: undefined,
      ratePerAcre: undefined,
      cost: undefined,
      acres: undefined,
    });

    expect(bare.success).toBe(true);
  });

  it("refuses a treatment of zero acres", () => {
    expect(pastureCareLogSchema.safeParse({ ...log(), acres: 0 }).success).toBe(false);
  });
});
