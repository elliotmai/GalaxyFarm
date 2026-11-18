import { describe, expect, it } from "vitest";

import {
  animalsOf,
  dailyDemandOf,
  feedingsPerDay,
  feedingPlanSchema,
  feedsAnimal,
  headsOf,
  plansForAnimal,
  plansForFlock,
  receptaclesFor,
  wrongSpecies,
  type FeedingPlan,
} from "../src/entities/feeding-plan.js";
import { audienceOf } from "../src/entities/animal.js";
import { quantity } from "../src/value-objects/quantity.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * Feeding plans (spec §5.1, decision 49) and the demand they imply (§5.3).
 *
 * A plan owns its animals: one species, the animals or flocks it feeds, each
 * or total, where, and what each feed goes in. The arithmetic is what the
 * "buy more hay" notification stands on — run-out is on-hand divided by this
 * — so a figure quietly half what it should be shows up as a hungry cow.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");

const plan = (over: Partial<FeedingPlan> = {}): FeedingPlan => ({
  id: id(1),
  propertyId: id(0),
  createdAt: AT,
  updatedAt: AT,
  name: "Pasture cows",
  species: "cattle",
  animalIds: [id(10), id(11), id(12)],
  flockIds: [],
  portion: "each",
  active: true,
  lines: [
    {
      feedTypeId: id(3),
      amount: quantity(6, "lb"),
      frequency: "twice_daily",
      timeOfDay: "morning",
      receptacle: "bunk",
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

  it("averages the less-than-daily frequencies rather than rounding them to one", () => {
    expect(feedingsPerDay("every_other_day")).toBe(0.5);
    expect(feedingsPerDay("twice_weekly")).toBeCloseTo(2 / 7);
    expect(feedingsPerDay("weekly")).toBeCloseTo(1 / 7);
  });
});

describe("dailyDemandOf", () => {
  it("multiplies an 'each' amount by how often and by the heads", () => {
    // 6 lb twice a day for three head is 36 lb.
    expect(dailyDemandOf(plan(), 3).get(id(3))).toEqual(quantity(36, "lb"));
  });

  it("does not multiply a 'total' amount by the heads", () => {
    // One bowl two cats share: the bowl is the amount, however many eat from it.
    expect(dailyDemandOf(plan({ portion: "total" }), 3).get(id(3))).toEqual(quantity(12, "lb"));
  });

  it("demands nothing when nobody on the plan is left, even for a 'total'", () => {
    expect(dailyDemandOf(plan({ portion: "total" }), 0).size).toBe(0);
  });

  it("adds two lines of the same feed rather than keeping only one", () => {
    const split = plan({
      lines: [
        {
          feedTypeId: id(3),
          amount: quantity(4, "lb"),
          frequency: "once_daily",
          timeOfDay: "morning",
        },
        {
          feedTypeId: id(3),
          amount: quantity(2, "lb"),
          frequency: "once_daily",
          timeOfDay: "evening",
        },
      ],
    });
    expect(dailyDemandOf(split, 1).get(id(3))).toEqual(quantity(6, "lb"));
  });

  it("refuses to add pounds to bales for one feed", () => {
    const mixed = plan({
      lines: [
        {
          feedTypeId: id(3),
          amount: quantity(4, "lb"),
          frequency: "once_daily",
          timeOfDay: "morning",
        },
        {
          feedTypeId: id(3),
          amount: quantity(1, "round_bale"),
          frequency: "weekly",
          timeOfDay: "morning",
        },
      ],
    });
    expect(() => dailyDemandOf(mixed, 1)).toThrow(/mixes units/);
  });

  it("demands nothing from a plan switched off", () => {
    expect(dailyDemandOf(plan({ active: false }), 3).size).toBe(0);
  });
});

describe("headsOf", () => {
  it("counts only the plan's animals still on the place", () => {
    // Steer 12 was sold and is still named on the plan until somebody tidies it.
    expect(headsOf(plan(), new Set([id(10), id(11)]))).toBe(2);
  });

  it("counts a flock by its headcount", () => {
    const hens = plan({ species: "chicken", animalIds: [], flockIds: [id(20)] });
    expect(headsOf(hens, new Set(), new Map([[id(20), 14]]))).toBe(14);
  });

  it("reads an old record with no members as feeding nobody, without throwing", () => {
    const old = { ...plan(), animalIds: undefined, flockIds: undefined } as unknown as FeedingPlan;
    expect(headsOf(old, new Set([id(10)]))).toBe(0);
    expect(animalsOf(old)).toEqual([]);
  });
});

describe("which plans feed whom", () => {
  it("finds every plan an animal is on — a base ration and a supplement both", () => {
    const base = plan({ id: id(1) });
    const mineral = plan({ id: id(2), name: "Mineral", animalIds: [id(10)] });
    const other = plan({ id: id(4), animalIds: [id(13)] });
    expect(plansForAnimal([base, mineral, other], id(10)).map((p) => p.id)).toEqual([id(1), id(2)]);
  });

  it("leaves out plans switched off", () => {
    expect(plansForAnimal([plan({ active: false })], id(10))).toEqual([]);
    expect(feedsAnimal(plan({ active: false }), id(10))).toBe(true);
  });

  it("finds a flock's plans", () => {
    const hens = plan({ species: "chicken", animalIds: [], flockIds: [id(20)] });
    expect(plansForFlock([hens], id(20))).toHaveLength(1);
  });
});

describe("feedingPlanSchema", () => {
  const valid = plan();

  it("accepts a complete plan", () => {
    expect(feedingPlanSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a plan with no feed in it", () => {
    expect(feedingPlanSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
  });

  it("refuses a plan that feeds nobody", () => {
    expect(feedingPlanSchema.safeParse({ ...valid, animalIds: [] }).success).toBe(false);
  });

  it("refuses a flock on anything but poultry", () => {
    expect(feedingPlanSchema.safeParse({ ...valid, flockIds: [id(20)] }).success).toBe(false);
    expect(
      feedingPlanSchema.safeParse({
        ...valid,
        species: "chicken",
        animalIds: [],
        flockIds: [id(20)],
        lines: [{ ...valid.lines[0], receptacle: "hanging_feeder" }],
      }).success,
    ).toBe(true);
  });

  it("refuses the same animal twice, which would count a head twice", () => {
    expect(feedingPlanSchema.safeParse({ ...valid, animalIds: [id(10), id(10)] }).success).toBe(
      false,
    );
  });

  it("refuses a receptacle the species is not fed from — no hay ring for a gecko", () => {
    const gecko = { ...valid, species: "reptile", animalIds: [id(30)] };
    expect(
      feedingPlanSchema.safeParse({
        ...gecko,
        lines: [{ ...valid.lines[0], receptacle: "hay_ring" }],
      }).success,
    ).toBe(false);
    expect(
      feedingPlanSchema.safeParse({ ...gecko, lines: [{ ...valid.lines[0], receptacle: "tongs" }] })
        .success,
    ).toBe(true);
  });

  it("defaults the member lists and the portion on the way in", () => {
    const { animalIds: _a, flockIds: _f, portion: _p, ...bare } = valid;
    const parsed = feedingPlanSchema.safeParse({ ...bare, animalIds: [id(10)] });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.flockIds).toEqual([]);
      expect(parsed.data.portion).toBe("each");
    }
  });
});

describe("knowing the animal", () => {
  it("tells pets from livestock", () => {
    expect(audienceOf("reptile")).toBe("pet");
    expect(audienceOf("dog")).toBe("pet");
    expect(audienceOf("horse")).toBe("livestock");
    expect(audienceOf("chicken")).toBe("livestock");
  });

  it("offers each species its own receptacles", () => {
    expect(receptaclesFor("cattle")).toContain("bunk");
    expect(receptaclesFor("cattle")).not.toContain("bowl");
    expect(receptaclesFor("dog")).toContain("bowl");
    expect(receptaclesFor("dog")).not.toContain("trough");
    expect(receptaclesFor("reptile")).toEqual(expect.arrayContaining(["dish", "tongs"]));
    expect(receptaclesFor("chicken")).toContain("hanging_feeder");
  });

  it("finds the animals on a plan that are not its species", () => {
    const animals = [
      { id: id(10), species: "cattle" as const },
      { id: id(11), species: "dog" as const },
    ];
    expect(wrongSpecies(plan({ animalIds: [id(10), id(11)] }), animals)).toEqual([id(11)]);
  });
});
