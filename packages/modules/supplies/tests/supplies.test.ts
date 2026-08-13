import { describe, expect, it } from "vitest";

import { fromDollars, type Ulid } from "@galaxy-farm/core";

import {
  isLowStock,
  stockOnHand,
  supplyItemSchema,
  supplyPurchaseSchema,
  supplyUsageSchema,
  usageCostFor,
  type SupplyItem,
  type SupplyPurchase,
  type SupplyUsage,
} from "../src/domain/supply-item.js";
import {
  assignedTo,
  currentlyAssigned,
  durableAssignmentSchema,
  inService,
  type DurableAssignment,
} from "../src/domain/durable.js";

/** Supplies (spec §5.11, added v0.3). */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const shavings: SupplyItem = {
  id: id(1),
  ...base,
  name: "Shavings",
  kind: "consumable",
  category: "bedding",
  unit: "bag",
  openingQty: 20,
  reorderThreshold: 6,
};

const panels: SupplyItem = {
  id: id(2),
  ...base,
  name: "Corral panels",
  kind: "durable",
  category: "pen_hardware",
  unit: "each",
  openingQty: 24,
};

const purchase = (over: Partial<SupplyPurchase> = {}): SupplyPurchase => ({
  id: id(10),
  ...base,
  supplyItemId: id(1),
  quantity: 12,
  unitCost: fromDollars(7.5),
  purchasedOn: new Date("2026-07-01"),
  ...over,
});

const usage = (over: Partial<SupplyUsage> = {}): SupplyUsage => ({
  id: id(20),
  ...base,
  supplyItemId: id(1),
  quantity: 4,
  usedOn: new Date("2026-08-01"),
  ...over,
});

describe("stockOnHand", () => {
  it("is opening plus purchases minus usage", () => {
    expect(stockOnHand(shavings, [purchase()], [usage()])).toBe(28);
  });

  it("ignores another item's records", () => {
    const other = purchase({ id: id(11), supplyItemId: id(2), quantity: 6 });
    expect(stockOnHand(shavings, [purchase(), other], [])).toBe(32);
  });
});

describe("isLowStock", () => {
  it("fires at or below the threshold", () => {
    expect(isLowStock(shavings, 6)).toBe(true);
    expect(isLowStock(shavings, 7)).toBe(false);
  });

  it("never fires for a durable", () => {
    // You do not reorder show halters when you are down to two; you buy one
    // when one breaks.
    expect(isLowStock(panels, 0)).toBe(false);
  });
});

describe("supplyItemSchema", () => {
  it("accepts both kinds", () => {
    expect(supplyItemSchema.safeParse(shavings).success).toBe(true);
    expect(supplyItemSchema.safeParse(panels).success).toBe(true);
  });

  it("refuses a reorder threshold on a durable", () => {
    const result = supplyItemSchema.safeParse({ ...panels, reorderThreshold: 4 });
    expect(result.success).toBe(false);
  });

  it("refuses a purchase or usage of nothing", () => {
    expect(supplyPurchaseSchema.safeParse({ ...purchase(), quantity: 0 }).success).toBe(false);
    expect(supplyUsageSchema.safeParse({ ...usage(), quantity: 0 }).success).toBe(false);
  });
});

describe("usageCostFor", () => {
  it("costs one animal's usage at the weighted average", () => {
    // §5.11: usage tagged to a client calf flows onto its boarding invoice.
    // The costing has to match feed's, because they land on the same invoice.
    const cheap = purchase({ quantity: 10, unitCost: fromDollars(7) });
    const dear = purchase({ id: id(12), quantity: 10, unitCost: fromDollars(9) });
    const forCalf = usage({ animalId: id(50), quantity: 3 });

    expect(usageCostFor(id(50), [forCalf], [cheap, dear])).toEqual(fromDollars(24));
  });

  it("charges nothing for usage tagged to somebody else", () => {
    expect(usageCostFor(id(51), [usage({ animalId: id(50) })], [purchase()])).toEqual(
      fromDollars(0),
    );
  });

  it("honours a billing window", () => {
    const january = usage({ animalId: id(50), usedOn: new Date("2026-01-15") });
    const august = usage({ id: id(21), animalId: id(50), usedOn: new Date("2026-08-01") });
    const window = { from: new Date("2026-07-01"), to: new Date("2026-08-31") };

    expect(usageCostFor(id(50), [january, august], [purchase()], window)).toEqual(fromDollars(30));
  });

  it("costs an item never purchased at nothing rather than throwing", () => {
    expect(usageCostFor(id(50), [usage({ animalId: id(50) })], [])).toEqual(fromDollars(0));
  });
});

// ---------------------------------------------------------------- durables

const assignment = (over: Partial<DurableAssignment> = {}): DurableAssignment => ({
  id: id(30),
  ...base,
  supplyItemId: id(2),
  quantity: 1,
  animalId: id(50),
  condition: "good",
  periodFrom: new Date("2026-06-01"),
  ...over,
});

describe("durable assignments", () => {
  it("says which halter is on which calf today", () => {
    expect(assignedTo([assignment()], id(50), AT)).toHaveLength(1);
    expect(assignedTo([assignment()], id(51), AT)).toEqual([]);
  });

  it("stops counting one that has been handed back", () => {
    const closed = assignment({ periodTo: new Date("2026-07-01") });
    expect(currentlyAssigned([closed], AT)).toEqual([]);
  });

  it("refuses to retire something without closing the assignment", () => {
    // Otherwise a retired halter still shows as being on a calf.
    const result = durableAssignmentSchema.safeParse({ ...assignment(), condition: "retired" });
    expect(result.success).toBe(false);
  });

  it("accepts a retirement that is properly closed", () => {
    const result = durableAssignmentSchema.safeParse({
      ...assignment(),
      condition: "retired",
      periodTo: new Date("2026-08-01"),
    });
    expect(result.success).toBe(true);
  });

  it("takes retired and lost items off the count in service", () => {
    // Twenty-four panels with two bent into scrap is twenty-two panels, and a
    // pen laid out against twenty-four will not close.
    const scrapped = assignment({
      id: id(31),
      quantity: 2,
      condition: "retired",
      periodTo: new Date("2026-07-01"),
    });

    expect(inService(id(2), 24, [assignment(), scrapped])).toBe(22);
  });
});
