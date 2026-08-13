import { describe, expect, it } from "vitest";

import {
  careHistoryFor,
  careSpendFor,
  costPerAcre,
  lastPerformed,
  pastureCareLogSchema,
  seasonalCareDue,
  SEASONAL_CARE,
  type PastureCareLog,
  type ZoneCareRef,
} from "../src/entities/pasture-care-log.js";
import { fromDollars, money } from "../src/value-objects/money.js";
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

describe("careSpendFor", () => {
  it("adds up what one pasture cost", () => {
    const first = log({ id: id(3), cost: fromDollars(420) });
    const second = log({ id: id(4), cost: fromDollars(80) });

    expect(careSpendFor([first, second], id(2))).toEqual({
      total: fromDollars(500),
      entries: 2,
      withoutCost: 0,
    });
  });

  it("counts the entries it could not price rather than treating them as free", () => {
    // The total is a floor once an entry has no cost against it. A screen that
    // shows it as the answer says the mow was free, which is how a per-pasture
    // cost history ends up cited in a decision it cannot support.
    const priced = log({ id: id(3), cost: fromDollars(420) });
    const mowed = log({ id: id(4), action: "mow", cost: undefined });

    expect(careSpendFor([priced, mowed], id(2))).toEqual({
      total: fromDollars(420),
      entries: 2,
      withoutCost: 1,
    });
  });

  it("is zero, not a crash, for a pasture nothing has been done to", () => {
    expect(careSpendFor([], id(2))).toEqual({ total: money(0), entries: 0, withoutCost: 0 });
  });

  it("does not add another pasture's spend to this one", () => {
    const elsewhere = log({ id: id(5), zoneId: id(9), cost: fromDollars(999) });

    expect(careSpendFor([elsewhere], id(2)).total).toEqual(money(0));
  });
});

describe("seasonalCareDue", () => {
  const pasture: ZoneCareRef = { id: id(2), name: "Hay Field", type: "pasture", active: true };
  const overseed = SEASONAL_CARE.filter((job) => job.action === "overseed");

  const on = (iso: string) => new Date(`${iso}T12:00:00`);

  it("calls the fall overseed due once its window is open and nothing is logged", () => {
    const [item] = seasonalCareDue([pasture], [], on("2026-10-01"), overseed);

    expect(item?.status).toBe("due");
    expect(item?.zoneName).toBe("Hay Field");
    expect(item?.lastPerformed).toBeUndefined();
  });

  it("counts work done inside the open window as done", () => {
    const seeded = log({ action: "overseed", performedOn: on("2026-09-20") });
    const [item] = seasonalCareDue([pasture], [seeded], on("2026-10-01"), overseed);

    expect(item?.status).toBe("done");
    expect(item?.lastPerformed).toEqual(on("2026-09-20"));
  });

  it("does not let last year's seeding answer for this year's window", () => {
    // The whole point of a seasonal reminder. A rye seeding from last October
    // satisfying this October is the failure that leaves a pasture bare all
    // winter with the app reporting it handled.
    const lastYear = log({ action: "overseed", performedOn: on("2025-10-04") });
    const [item] = seasonalCareDue([pasture], [lastYear], on("2026-10-01"), overseed);

    expect(item?.status).toBe("due");
    expect(item?.lastPerformed).toEqual(on("2025-10-04"));
  });

  it("names the next window rather than a closed one, once the season is past", () => {
    const [item] = seasonalCareDue([pasture], [], on("2026-12-20"), overseed);

    expect(item?.status).toBe("scheduled");
    expect(item?.opensOn.getFullYear()).toBe(2027);
    expect(item?.opensOn.getMonth()).toBe(8); // September
  });

  it("waits rather than nagging before the window opens", () => {
    const [item] = seasonalCareDue([pasture], [], on("2026-08-13"), overseed);

    expect(item?.status).toBe("scheduled");
    expect(item?.opensOn).toEqual(new Date(2026, 8, 1));
    expect(item?.closesOn.getMonth()).toBe(10); // through November
  });

  it("handles a window that wraps the new year", () => {
    // An unwrapped comparison finds no month between 11 and 2 and reports the
    // work as never due, which reads exactly like nothing needing doing.
    const winter = [{ action: "spray" as const, label: "Winter spray", fromMonth: 11, toMonth: 2 }];

    expect(seasonalCareDue([pasture], [], on("2027-01-15"), winter)[0]?.status).toBe("due");
    expect(seasonalCareDue([pasture], [], on("2026-06-15"), winter)[0]?.opensOn).toEqual(
      new Date(2026, 10, 1),
    );
  });

  it("leaves out pens, chutes and anything not in use", () => {
    const pen: ZoneCareRef = { id: id(6), name: "West Pen", type: "pen", active: true };
    const chute: ZoneCareRef = {
      id: id(7),
      name: "Tub / chute",
      type: "working_facility",
      active: true,
    };
    const sold: ZoneCareRef = { ...pasture, id: id(8), name: "Old lease", active: false };

    const items = seasonalCareDue([pasture, pen, chute, sold], [], on("2026-10-01"), overseed);

    expect(items.map((item) => item.zoneName)).toEqual(["Hay Field"]);
  });

  it("asks both of the spec's seasonal jobs by default", () => {
    const items = seasonalCareDue([pasture], [], on("2026-10-01"));

    expect(items.map((item) => item.job.action)).toEqual(["overseed", "fertilize"]);
    expect(items.find((item) => item.job.action === "fertilize")?.status).toBe("scheduled");
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

  it("refuses a rate in a unit nothing is spread in", () => {
    // Millilitres per acre is a typo, not a rate. Catching it here is what
    // keeps it out of next fall's comparison against this one.
    expect(
      pastureCareLogSchema.safeParse({ ...log(), ratePerAcre: quantity(50, "ml") }).success,
    ).toBe(false);
    expect(
      pastureCareLogSchema.safeParse({ ...log(), ratePerAcre: quantity(2, "bag") }).success,
    ).toBe(true);
  });
});
