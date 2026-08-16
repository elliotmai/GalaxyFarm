import { describe, expect, it } from "vitest";

import type { FeedingPlanLine, Ulid } from "@galaxy-farm/core";
import { POUNDS_PER_BAG, POUNDS_PER_SCOOP, type FeedType } from "@galaxy-farm/module-feed";

import {
  describeLine,
  describePlanLine,
  mixedUnitFeed,
  nameList,
  type PlanLineDraft,
} from "../lib/feed-lines";

/**
 * Writing a ration in the units it is actually fed in (spec §5.3).
 *
 * Cubes are bought by the bag and fed by the scoop, and a form that made
 * somebody write "0.15 bags" twice a day would be a form nobody used. So the
 * unit is per line rather than taken off the catalogue — which puts two ways
 * to get it wrong within reach, and both are checked here.
 */

const line = (over: Partial<PlanLineDraft> = {}): PlanLineDraft => ({
  feedId: "cubes",
  amount: "3",
  unit: "scoop",
  frequency: "twice_daily",
  ...over,
});

describe("one feed, two units", () => {
  it("names the feed two lines disagree about", () => {
    // `dailyDemandOf` throws on this rather than adding bags to scoops, and
    // the throw lands on whichever screen reads the plan back — not on the one
    // that wrote it.
    expect(mixedUnitFeed([line(), line({ unit: "bag" })])).toBe("cubes");
  });

  it("is content with two lines of the same feed in one unit", () => {
    // The classic morning-and-evening split, which is an ordinary plan.
    expect(
      mixedUnitFeed([line({ frequency: "once_daily" }), line({ frequency: "once_daily" })]),
    ).toBeUndefined();
  });

  it("is content with two feeds in different units", () => {
    expect(mixedUnitFeed([line(), line({ feedId: "hay", unit: "round_bale" })])).toBeUndefined();
  });

  it("ignores a line where nothing has been chosen yet", () => {
    // Two half-filled rows are not a disagreement about anything.
    expect(
      mixedUnitFeed([line({ feedId: "" }), line({ feedId: "", unit: "bag" })]),
    ).toBeUndefined();
  });
});

describe("saying a line back while it is typed", () => {
  it("gives the feeding and the day in vessels and in pounds", () => {
    expect(describeLine(line(), undefined)).toBe(
      "3 scoops each time — 6 scoops a day, about 16.7 lb.",
    );
  });

  it("stays in pounds for a feed that is not measured in vessels", () => {
    expect(describeLine(line({ unit: "lb", amount: "12" }), undefined)).toBe(
      "12 lb each time — 24 lb a day.",
    );
  });

  it("uses the feed's own weight for the unit it is catalogued in", () => {
    expect(
      describeLine(line({ unit: "bag", amount: "1", frequency: "once_daily" }), {
        unit: "bag",
        estWeightLbPerUnit: 40,
      }),
    ).toContain("about 40 lb");
  });

  it("does not apply a bale's weight to a scoop of it", () => {
    // A 1,200 lb round bale says nothing about what a scoop of it weighs, and
    // borrowing the figure would report a scoop as most of a ton.
    expect(
      describeLine(line({ amount: "1" }), { unit: "round_bale", estWeightLbPerUnit: 1200 }),
    ).toBe(
      `1 scoop each time — 2 scoops a day, about ${Number((POUNDS_PER_SCOOP * 2).toFixed(1))} lb.`,
    );
  });

  it("says nothing at all rather than guessing at a bale nobody weighed", () => {
    // A made-up weight per unit propagates into a run-out date somebody drives
    // to town on.
    expect(describeLine(line({ unit: "round_bale" }), undefined)).toBe("");
  });

  it("says nothing before an amount has been typed", () => {
    expect(describeLine(line({ amount: "" }), undefined)).toBe("");
    expect(describeLine(line({ amount: "0" }), undefined)).toBe("");
    expect(describeLine(line({ amount: "-2" }), undefined)).toBe("");
  });

  it("reads an amount in the wrong unit as the absurd figure it is", () => {
    // The reason this line is on the screen at all: 18 bags twice a day is
    // 1,800 lb, and it is obvious here in a way it is not in the input.
    expect(describeLine(line({ unit: "bag", amount: "18" }), undefined)).toContain(
      `about ${POUNDS_PER_BAG * 18 * 2} lb`,
    );
  });
});

/**
 * A saved line, said out loud (spec §5.1, §5.8, §5.10).
 *
 * The pet card, the plan list and the housesitter guide's cattle feeding
 * section all read this sentence, which is the point of it having one home:
 * three screens wording the same ration three ways is three chances to
 * disagree about the amount.
 */

const KIBBLE = "01ARZ3NDEKTSV4RRFFQ69G5F10" as Ulid;

const feeds = [
  { id: KIBBLE, name: "Purina Pro Plan", category: "pet", unit: "scoop", active: true },
] as unknown as FeedType[];

const planLine = (overrides: Partial<FeedingPlanLine>): FeedingPlanLine => ({
  feedTypeId: KIBBLE,
  amount: { amount: 1, unit: "scoop" },
  frequency: "twice_daily",
  timeOfDay: "morning",
  ...overrides,
});

describe("describePlanLine", () => {
  it("says the ration the way somebody would say it out loud", () => {
    expect(describePlanLine(planLine({}), feeds)).toBe(
      "1 scoop of Purina Pro Plan, twice a day, morning",
    );
  });

  it("pluralises the vessel", () => {
    expect(describePlanLine(planLine({ amount: { amount: 2, unit: "scoop" } }), feeds)).toContain(
      "2 scoops",
    );
  });

  it("keeps the line's own note, which is usually the important half", () => {
    expect(describePlanLine(planLine({ notes: "in the blue bowl" }), feeds)).toBe(
      "1 scoop of Purina Pro Plan, twice a day, morning — in the blue bowl",
    );
  });

  it("says 'feed' rather than nothing when the catalogue entry is gone", () => {
    // A deleted feed must not make the whole line vanish off the guide.
    expect(describePlanLine(planLine({}), [])).toContain("of feed");
  });

  it("reads a multi-word unit as words", () => {
    expect(
      describePlanLine(planLine({ amount: { amount: 1, unit: "square_bale" } }), feeds),
    ).toContain("1 square bale");
  });

  it("names who a shared amount is split between", () => {
    // Half a pound twice a day on each of two cards is a pound a day going
    // into a bowl that only wanted half.
    expect(describePlanLine(planLine({}), feeds, ["Smokey", "Boots"])).toContain(
      "between Smokey and Boots",
    );
  });
});

describe("nameList", () => {
  it("reads the way somebody would say it", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["Rusty"])).toBe("Rusty");
    expect(nameList(["Rusty", "Biscuit"])).toBe("Rusty and Biscuit");
    expect(nameList(["Rusty", "Biscuit", "Tig"])).toBe("Rusty, Biscuit and Tig");
  });
});
