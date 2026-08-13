import { describe, expect, it } from "vitest";

import { POUNDS_PER_BAG, POUNDS_PER_SCOOP } from "@galaxy-farm/module-feed";

import { describeLine, mixedUnitFeed, type PlanLineDraft } from "../lib/feed-lines";

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
