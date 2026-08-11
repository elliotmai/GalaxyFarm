import { describe, expect, it } from "vitest";

import {
  dailyDemandOf,
  feedingsPerDay,
  feedingPlanSchema,
  plansForAnimal,
  type FeedingPlan,
} from "../src/entities/feeding-plan.js";
import { quantity } from "../src/value-objects/quantity.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * Feeding plans (spec §5.1) and the demand they imply (§5.3).
 *
 * The arithmetic here is what the "buy more hay" notification stands on, so it
 * is worth being exact about: run-out date is on-hand divided by this number,
 * and a demand figure that is quietly half what it should be shows up as a
 * hungry cow rather than as a wrong report.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");

const plan = (over: Partial<FeedingPlan> = {}): FeedingPlan => ({
  id: id(1),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  name: "Pasture cows",
  target: "zone",
  targetId: id(2),
  active: true,
  lines: [
    {
      feedTypeId: id(3),
      amount: quantity(6, "lb"),
      frequency: "twice_daily",
      timeOfDay: "morning",
    },
  ],
  ...over,
});

describe("feedingsPerDay", () => {
  it.each([
    ["once_daily", 1],
    ["twice_daily", 2],
    ["three_times_daily", 3],
  ] as const)("%s is %s", (frequency, expected) => {
    expect(feedingsPerDay(frequency)).toBe(expected);
  });

  it("averages the sub-daily frequencies rather than rounding them to one", () => {
    // Every other day is half a feeding per day. Rounding it up would overstate
    // demand by 100% and buy twice the hay.
    expect(feedingsPerDay("every_other_day")).toBe(0.5);
    expect(feedingsPerDay("weekly")).toBeCloseTo(1 / 7, 10);
  });
});

describe("dailyDemandOf", () => {
  it("multiplies quantity by frequency", () => {
    const demand = dailyDemandOf(plan());
    expect(demand.get(id(3))).toEqual({ amount: 12, unit: "lb" });
  });

  it("adds two lines of the same feed rather than keeping only one", () => {
    // The morning-and-evening grain split is the normal case, not an edge one.
    const demand = dailyDemandOf(
      plan({
        lines: [
          {
            feedTypeId: id(3),
            amount: quantity(4, "lb"),
            frequency: "once_daily",
            timeOfDay: "morning",
          },
          {
            feedTypeId: id(3),
            amount: quantity(5, "lb"),
            frequency: "once_daily",
            timeOfDay: "evening",
          },
        ],
      }),
    );

    expect(demand.get(id(3))).toEqual({ amount: 9, unit: "lb" });
  });

  it("keeps different feeds apart instead of summing incomparable units", () => {
    const demand = dailyDemandOf(
      plan({
        lines: [
          {
            feedTypeId: id(3),
            amount: quantity(6, "lb"),
            frequency: "twice_daily",
            timeOfDay: "morning",
          },
          {
            feedTypeId: id(4),
            amount: quantity(1, "round_bale"),
            frequency: "every_other_day",
            timeOfDay: "morning",
          },
        ],
      }),
    );

    expect(demand.get(id(3))).toEqual({ amount: 12, unit: "lb" });
    expect(demand.get(id(4))).toEqual({ amount: 0.5, unit: "round_bale" });
  });

  it("refuses to add pounds to bales for one feed type", () => {
    expect(() =>
      dailyDemandOf(
        plan({
          lines: [
            {
              feedTypeId: id(3),
              amount: quantity(6, "lb"),
              frequency: "once_daily",
              timeOfDay: "morning",
            },
            {
              feedTypeId: id(3),
              amount: quantity(1, "round_bale"),
              frequency: "once_daily",
              timeOfDay: "evening",
            },
          ],
        }),
      ),
    ).toThrow(/mixes units/);
  });

  it("demands nothing from an inactive plan", () => {
    // Turning a winter plan off has to stop it counting towards run-out, or
    // the app orders hay all summer.
    expect(dailyDemandOf(plan({ active: false })).size).toBe(0);
  });
});

describe("plansForAnimal", () => {
  const group = plan({ id: id(10), target: "group", targetId: id(20), name: "Show string" });
  const zone = plan({ id: id(11), target: "zone", targetId: id(21), name: "Pen B" });
  const animal = plan({ id: id(12), target: "animal", targetId: id(22), name: "Andromeda" });

  it("returns group, then zone, then animal — most specific last", () => {
    // §5.1: an animal-targeted plan "overrides/extends the group plan". A
    // caller folding these in order gets that for free; any other order makes
    // the general plan win.
    const found = plansForAnimal([animal, group, zone], id(22), [id(21)], [id(20)]);

    expect(found.map((p) => p.name)).toEqual(["Show string", "Pen B", "Andromeda"]);
  });

  it("ignores plans for other animals and other pens", () => {
    expect(plansForAnimal([animal, zone], id(99), [id(98)])).toEqual([]);
  });

  it("ignores inactive plans wherever they are targeted", () => {
    const off = plan({ id: id(13), target: "animal", targetId: id(22), active: false });
    expect(plansForAnimal([off], id(22), [])).toEqual([]);
  });
});

describe("feedingPlanSchema", () => {
  it("refuses a plan with no lines", () => {
    // A plan that feeds nothing is a plan somebody abandoned halfway through
    // making, and it would contribute a silent zero to daily demand.
    const result = feedingPlanSchema.safeParse({ ...plan(), lines: [] });
    expect(result.success).toBe(false);
  });

  it("accepts a complete plan", () => {
    expect(feedingPlanSchema.safeParse(plan()).success).toBe(true);
  });
});
