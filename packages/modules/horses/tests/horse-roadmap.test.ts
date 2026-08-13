import { describe, expect, it } from "vitest";

import {
  fromDollars,
  type PurchaseCandidate,
  type RoadmapItem,
  type Ulid,
} from "@galaxy-farm/core";

import {
  budgetOutlook,
  horseCandidates,
  horseItems,
  nextUp,
  shoppingFor,
  spentAgainstPlan,
  unshopped,
  wantFor,
} from "../src/domain/horse-roadmap.js";

/**
 * The horse roadmap (spec §5.9).
 *
 * There are no horses here and will not be for years, which is exactly why
 * this is live: the wants, the budget, and what is under consideration against
 * each want are the whole of the decision until the trailer is hooked up.
 *
 * The cases that matter are the ones where a number would otherwise lie — an
 * unpriced want counted as free, a cheaper-looking horse that is dearer once
 * it is hauled here, and a want with no candidate reading the same as a want
 * whose candidates were all turned down.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const property = id(99);

const item = (over: Partial<RoadmapItem> & { title: string }): RoadmapItem =>
  ({
    id: id(1),
    propertyId: property,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    domain: "horses",
    type: "wishlist",
    priority: "want",
    status: "open",
    ...over,
  }) as RoadmapItem;

const candidate = (over: Partial<PurchaseCandidate> & { title: string }): PurchaseCandidate =>
  ({
    id: id(2),
    propertyId: property,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    domain: "horses",
    status: "watching",
    askingPrice: fromDollars(5_000),
    additionalCosts: [],
    firstSeen: new Date("2026-01-01"),
    photoKeys: [],
    pros: [],
    cons: [],
    planStatus: "open",
    ...over,
  }) as PurchaseCandidate;

describe("horseItems", () => {
  it("takes only the horses out of a table three domains share", () => {
    const items = [
      item({ id: id(10), title: "A ranch gelding" }),
      item({ id: id(11), title: "A second truck", domain: "equipment" }),
      item({ id: id(12), title: "Twenty head by year five", domain: "cattle" }),
    ];

    expect(horseItems(items).map((entry) => entry.title)).toEqual(["A ranch gelding"]);
    expect(horseCandidates([candidate({ title: "Sorrel mare", domain: "cattle" })])).toEqual([]);
  });
});

describe("budgetOutlook", () => {
  it("adds the open wants up by priority", () => {
    const outlook = budgetOutlook([
      item({
        id: id(10),
        title: "A ranch gelding",
        priority: "need",
        budgetEstimate: fromDollars(8_000),
      }),
      item({
        id: id(11),
        title: "A trail horse",
        priority: "want",
        budgetEstimate: fromDollars(4_500),
      }),
      item({
        id: id(12),
        title: "A second saddle",
        priority: "want",
        budgetEstimate: fromDollars(1_500),
      }),
      item({
        id: id(13),
        title: "A weanling to bring on",
        priority: "someday",
        budgetEstimate: fromDollars(2_000),
      }),
    ]);

    expect(outlook.byPriority.need.cents).toBe(800_000);
    expect(outlook.byPriority.want.cents).toBe(600_000);
    expect(outlook.byPriority.someday.cents).toBe(200_000);
    expect(outlook.total.cents).toBe(1_600_000);
  });

  it("says how many wants it could not price rather than counting them as free", () => {
    const outlook = budgetOutlook([
      item({ id: id(10), title: "A ranch gelding", budgetEstimate: fromDollars(8_000) }),
      item({ id: id(11), title: "Somewhere to keep it" }),
    ]);

    expect(outlook.total.cents).toBe(800_000);
    expect(outlook.unpriced).toBe(1);
  });

  it("leaves out what has been achieved or dropped", () => {
    const outlook = budgetOutlook([
      item({ id: id(10), title: "Bought", status: "achieved", budgetEstimate: fromDollars(8_000) }),
      item({
        id: id(11),
        title: "Thought better of",
        status: "dropped",
        budgetEstimate: fromDollars(9_000),
      }),
      item({ id: id(12), title: "Still wanted", budgetEstimate: fromDollars(1_000) }),
    ]);

    expect(outlook.total.cents).toBe(100_000);
    expect(outlook.unpriced).toBe(0);
  });

  it("counts nothing from another domain's roadmap", () => {
    const outlook = budgetOutlook([
      item({
        id: id(10),
        title: "A baler",
        domain: "equipment",
        budgetEstimate: fromDollars(20_000),
      }),
    ]);

    expect(outlook.total.cents).toBe(0);
  });
});

describe("nextUp", () => {
  const now = new Date("2026-06-01");

  it("puts needs before wants before somedays", () => {
    const order = nextUp(
      [
        item({ id: id(10), title: "Someday", priority: "someday" }),
        item({ id: id(11), title: "Want", priority: "want" }),
        item({ id: id(12), title: "Need", priority: "need" }),
      ],
      now,
    ).map((step) => step.item.title);

    expect(order).toEqual(["Need", "Want", "Someday"]);
  });

  it("puts a dated item ahead of an undated one at the same priority", () => {
    // An item with a target has somewhere to be. One without is waiting on it.
    const order = nextUp(
      [
        item({ id: id(10), title: "No date" }),
        item({ id: id(11), title: "August", targetDate: new Date("2026-08-01") }),
        item({ id: id(12), title: "July", targetDate: new Date("2026-07-01") }),
      ],
      now,
    ).map((step) => step.item.title);

    expect(order).toEqual(["July", "August", "No date"]);
  });

  it("marks a target date that has gone by with the item still open", () => {
    const [first] = nextUp(
      [item({ id: id(10), title: "Last spring", targetDate: new Date("2026-03-01") })],
      now,
    );

    expect(first?.overdue).toBe(true);
  });

  it("does not call an achieved item overdue, because it is not open", () => {
    expect(
      nextUp(
        [
          item({
            id: id(10),
            title: "Done",
            status: "achieved",
            targetDate: new Date("2026-03-01"),
          }),
        ],
        now,
      ),
    ).toEqual([]);
  });
});

describe("shoppingFor", () => {
  const want = item({
    id: id(20),
    title: "A ranch gelding",
    priority: "need",
    budgetEstimate: fromDollars(6_000),
  });

  it("ranks the candidates against a want on the all-in cost, not the asking price", () => {
    // The cheaper sticker is four hundred miles away. §5.1's whole point.
    const far = candidate({
      id: id(30),
      title: "Sorrel gelding, Amarillo",
      roadmapItemId: want.id,
      askingPrice: fromDollars(4_800),
      additionalCosts: [{ label: "Hauling", amount: fromDollars(900) }],
    });
    const near = candidate({
      id: id(31),
      title: "Bay gelding, Weatherford",
      roadmapItemId: want.id,
      askingPrice: fromDollars(5_200),
      additionalCosts: [{ label: "Hauling", amount: fromDollars(150) }],
    });

    const [entry] = shoppingFor([want], [far, near]);

    expect(entry?.live).toHaveLength(2);
    expect(entry?.cheapest?.title).toBe("Bay gelding, Weatherford");
    expect(entry?.overBudget).toBe(false);
  });

  it("calls the cheapest over budget when hauling takes it over", () => {
    const entry = shoppingFor(
      [want],
      [
        candidate({
          id: id(30),
          title: "Palomino mare",
          roadmapItemId: want.id,
          askingPrice: fromDollars(5_900),
          additionalCosts: [{ label: "Vet check", amount: fromDollars(250) }],
        }),
      ],
    )[0];

    expect(entry?.overBudget).toBe(true);
  });

  it("says nothing about budget for a want that carries no estimate", () => {
    const unpriced = item({ id: id(21), title: "Something quiet for the kids" });
    const entry = shoppingFor(
      [unpriced],
      [candidate({ id: id(30), title: "Pony", roadmapItemId: unpriced.id })],
    )[0];

    expect(entry?.cheapest?.title).toBe("Pony");
    expect(entry?.overBudget).toBeUndefined();
  });

  it("leaves out candidates already bought, passed on, or sold to somebody else", () => {
    const entry = shoppingFor(
      [want],
      [
        candidate({ id: id(30), title: "Passed", roadmapItemId: want.id, status: "passed" }),
        candidate({ id: id(31), title: "Gone", roadmapItemId: want.id, status: "gone" }),
        candidate({ id: id(32), title: "Bought", roadmapItemId: want.id, status: "purchased" }),
      ],
    )[0];

    expect(entry?.live).toEqual([]);
    expect(entry?.cheapest).toBeUndefined();
  });

  it("only pairs goals and milestones in when asked", () => {
    const goal = item({ id: id(22), title: "Everyone can ride", type: "goal" });

    expect(shoppingFor([goal], [])).toEqual([]);
    expect(shoppingFor([goal], [], ["goal"]).map((entry) => entry.item.title)).toEqual([
      "Everyone can ride",
    ]);
  });
});

describe("unshopped", () => {
  it("separates a want nobody has started from one whose candidates were turned down", () => {
    // Both have no live candidate, and they need opposite next actions: go
    // looking, versus keep looking. Only the first is a want nobody has walked.
    const untouched = item({ id: id(20), title: "A trail horse" });
    const tried = item({ id: id(21), title: "A ranch gelding" });

    const wants = unshopped(
      [untouched, tried],
      [
        candidate({
          id: id(30),
          title: "Bay gelding",
          roadmapItemId: tried.id,
          status: "watching",
        }),
      ],
    );

    expect(wants.map((entry) => entry.title)).toEqual(["A trail horse"]);
  });
});

describe("spentAgainstPlan", () => {
  it("counts what was bought, all in, against what was set aside", () => {
    const plan = [
      item({ id: id(20), title: "A ranch gelding", budgetEstimate: fromDollars(6_000) }),
    ];
    const bought = candidate({
      id: id(30),
      title: "Bay gelding",
      status: "purchased",
      askingPrice: fromDollars(5_200),
      additionalCosts: [{ label: "Hauling", amount: fromDollars(150) }],
    });

    const result = spentAgainstPlan(plan, [
      bought,
      candidate({ id: id(31), title: "Still looking" }),
    ]);

    expect(result.spent.cents).toBe(535_000);
    expect(result.planned.cents).toBe(600_000);
    expect(result.remaining.cents).toBe(65_000);
  });

  it("goes negative rather than clamping when the horse cost more than the plan", () => {
    const result = spentAgainstPlan(
      [item({ id: id(20), title: "A ranch gelding", budgetEstimate: fromDollars(4_000) })],
      [
        candidate({
          id: id(30),
          title: "Bay gelding",
          status: "purchased",
          askingPrice: fromDollars(5_000),
        }),
      ],
    );

    expect(result.remaining.cents).toBe(-100_000);
  });
});

describe("wantFor", () => {
  it("finds the want a candidate is being bought against", () => {
    const want = item({ id: id(20), title: "A ranch gelding" });

    expect(wantFor({ roadmapItemId: want.id }, [want])?.title).toBe("A ranch gelding");
    expect(wantFor({ roadmapItemId: undefined }, [want])).toBeUndefined();
    expect(wantFor({ roadmapItemId: id(77) }, [want])).toBeUndefined();
  });
});
