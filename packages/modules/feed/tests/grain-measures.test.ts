import { describe, expect, it } from "vitest";

import {
  describeGrain,
  isGrainMeasure,
  measureToPounds,
  poundsOf,
  poundsToMeasure,
  POUNDS_PER_BAG,
  POUNDS_PER_BUCKET,
  POUNDS_PER_SCOOP,
  toNearestHalf,
} from "../src/index.js";

/**
 * The vessels grain is measured in (spec §5.3).
 *
 * Nobody here weighs feed. A bag comes off the trailer, it is tipped into
 * buckets, and what goes in the trough is scoops. The conversions come from
 * ZNT Manager's feeding page, where they were arrived at by using them: a bag
 * is 50 lb, two buckets make a bag, eighteen scoops make a bag.
 */

describe("what a vessel holds", () => {
  it("holds the figures the feed shed runs on", () => {
    expect(POUNDS_PER_BAG).toBe(50);
    expect(POUNDS_PER_BUCKET).toBe(25);
    expect(POUNDS_PER_SCOOP).toBeCloseTo(2.78, 2);
  });

  it("makes two buckets a bag and eighteen scoops a bag", () => {
    expect(measureToPounds(2, "bucket")).toBe(POUNDS_PER_BAG);
    expect(measureToPounds(18, "scoop")).toBeCloseTo(POUNDS_PER_BAG, 6);
  });

  it("converts back the way it converted out", () => {
    expect(poundsToMeasure(50, "bag")).toBe(1);
    expect(poundsToMeasure(50, "bucket")).toBe(2);
    expect(poundsToMeasure(50, "scoop")).toBeCloseTo(18, 6);
  });

  it("believes the feed over the default", () => {
    // A scoop of cubes and a scoop of a light textured feed are not the same
    // weight, and the feed is the only thing that knows which this is.
    expect(measureToPounds(3, "scoop", 4)).toBe(12);
    expect(poundsToMeasure(12, "scoop", 4)).toBe(3);
  });

  it("says nothing rather than guessing at a vessel it does not know", () => {
    // A made-up weight per unit propagates into a run-out date somebody drives
    // to town on.
    expect(measureToPounds(1, "round_bale")).toBeUndefined();
    expect(poundsToMeasure(1, "each")).toBeUndefined();
  });

  it("knows which units are vessels", () => {
    expect(isGrainMeasure("scoop")).toBe(true);
    expect(isGrainMeasure("bucket")).toBe(true);
    expect(isGrainMeasure("bag")).toBe(true);
    expect(isGrainMeasure("round_bale")).toBe(false);
  });
});

describe("a feed's weight per unit", () => {
  it("wins over the default for the same vessel", () => {
    expect(poundsOf({ unit: "bag", estWeightLbPerUnit: 40 }, 2)).toBe(80);
  });

  it("falls back to what the vessel holds", () => {
    expect(poundsOf({ unit: "bucket", estWeightLbPerUnit: undefined }, 2)).toBe(50);
    expect(poundsOf({ unit: "scoop", estWeightLbPerUnit: undefined }, 18)).toBeCloseTo(50, 6);
  });

  it("still says nothing for a bale nobody has weighed", () => {
    expect(poundsOf({ unit: "round_bale", estWeightLbPerUnit: undefined }, 1)).toBeUndefined();
  });
});

describe("saying an amount out loud", () => {
  it("rounds to the nearest half, because nobody measures a third of a scoop", () => {
    expect(toNearestHalf(2.26)).toBe(2.5);
    expect(toNearestHalf(2.74)).toBe(2.5);
  });

  it("uses scoops for anything under a bucket", () => {
    expect(describeGrain(POUNDS_PER_SCOOP * 3)).toBe("3 scoops");
    expect(describeGrain(POUNDS_PER_SCOOP)).toBe("1 scoop");
  });

  it("uses buckets past a bucket, and names the remainder as scoops", () => {
    // "1.5 buckets" is a number somebody has to convert at the shed door. The
    // whole point of these units is that nobody should have to.
    expect(describeGrain(POUNDS_PER_BUCKET + POUNDS_PER_SCOOP * 2)).toBe("1 bucket + 2 scoops");
  });

  it("carries a remainder that rounds up into the next vessel", () => {
    // Nine scoops is a bucket, and "1 bucket + 9 scoops" is two buckets said
    // badly.
    expect(describeGrain(POUNDS_PER_BUCKET * 2 - 0.1)).toBe("1 bag");
    expect(describeGrain(POUNDS_PER_BUCKET - 0.1)).toBe("1 bucket");
  });

  it("leaves the remainder off when it comes out even", () => {
    expect(describeGrain(POUNDS_PER_BUCKET)).toBe("1 bucket");
    expect(describeGrain(POUNDS_PER_BAG)).toBe("1 bag");
  });

  it("uses bags past a bag, and counts down from there", () => {
    expect(describeGrain(POUNDS_PER_BAG * 2 + POUNDS_PER_BUCKET)).toBe("2 bags + 1 bucket");
    expect(describeGrain(POUNDS_PER_BAG + POUNDS_PER_BUCKET + POUNDS_PER_SCOOP * 3)).toBe(
      "1 bag + 1 bucket + 3 scoops",
    );
  });

  it("says nothing is nothing rather than dividing by it", () => {
    expect(describeGrain(0)).toBe("0 scoops");
    expect(describeGrain(-5)).toBe("0 scoops");
    expect(describeGrain(Number.NaN)).toBe("0 scoops");
  });

  it("takes a feed's own vessel weights", () => {
    // Ten pounds to the bucket, so twenty pounds is two of them.
    expect(describeGrain(20, { perBag: 20, perBucket: 10, perScoop: 2 })).toBe("1 bag");
    expect(describeGrain(14, { perBag: 20, perBucket: 10, perScoop: 2 })).toBe(
      "1 bucket + 2 scoops",
    );
  });
});
