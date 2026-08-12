import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import type { ParentRef } from "../src/domain/cattle-profile.js";
import type { PedigreeSource } from "../src/domain/pedigree.js";
import {
  expectedComposition,
  relatedness,
  relatednessVerdict,
} from "../src/domain/mating-analysis.js";

/**
 * What a pairing produces (§5.2).
 *
 * The inbreeding cases are the ones worth writing down, because every one has
 * a textbook answer: half-sibs are 12.5%, first cousins 6.25%, and a parent
 * bred to its own offspring 25%. A coefficient that disagrees with those is
 * wrong regardless of how reasonable the code looks.
 */

const id = (value: string) => value as Ulid;
const ref = (value: string): ParentRef => ({ kind: "external", id: id(value) });

/** A pedigree held as a plain map, which is all `PedigreeSource` ever needs. */
function sourceOf(tree: Record<string, { sire?: string; dam?: string }>): PedigreeSource {
  return {
    parentsOf(parent) {
      const entry = tree[parent.id];
      if (entry === undefined) return undefined;
      return {
        ...(entry.sire === undefined ? {} : { sire: ref(entry.sire) }),
        ...(entry.dam === undefined ? {} : { dam: ref(entry.dam) }),
      };
    },
    describe(parent) {
      return tree[parent.id] === undefined ? undefined : { name: parent.id };
    },
  };
}

describe("expected breed composition", () => {
  it("halves each parent's share", () => {
    const calf = expectedComposition(
      [{ breed: "Shorthorn", percent: 100 }],
      [
        { breed: "Maine-Anjou", percent: 50 },
        { breed: "Chianina", percent: 50 },
      ],
    );

    expect(calf).toEqual([
      { breed: "Shorthorn", percent: 50 },
      { breed: "Maine-Anjou", percent: 25 },
      { breed: "Chianina", percent: 25 },
    ]);
  });

  it("adds a breed both parents carry rather than listing it twice", () => {
    const calf = expectedComposition(
      [
        { breed: "Maine-Anjou", percent: 50 },
        { breed: "Angus", percent: 50 },
      ],
      [{ breed: "Maine-Anjou", percent: 100 }],
    );

    expect(calf).toEqual([
      { breed: "Maine-Anjou", percent: 75 },
      { breed: "Angus", percent: 25 },
    ]);
  });

  it("treats a breed spelled two ways as one breed", () => {
    // "maine-anjou" and "Maine-Anjou" are the same animal's breeding, and a
    // composition listing both adds to 100 while looking like a mistake.
    const calf = expectedComposition(
      [{ breed: "Maine-Anjou", percent: 100 }],
      [{ breed: "maine-anjou", percent: 100 }],
    );

    expect(calf).toEqual([{ breed: "Maine-Anjou", percent: 100 }]);
  });

  it("still adds to 100 when both parents do", () => {
    const calf = expectedComposition(
      [{ breed: "A", percent: 100 }],
      [
        { breed: "B", percent: 75 },
        { breed: "C", percent: 25 },
      ],
    );

    expect(calf.reduce((total, share) => total + share.percent, 0)).toBeCloseTo(100);
  });
});

describe("how close two animals are", () => {
  it("finds nothing between two unrelated animals", () => {
    const source = sourceOf({
      bull: { sire: "bull-sire", dam: "bull-dam" },
      cow: { sire: "cow-sire", dam: "cow-dam" },
      "bull-sire": {},
      "bull-dam": {},
      "cow-sire": {},
      "cow-dam": {},
    });

    const report = relatedness(ref("bull"), ref("cow"), source);

    expect(report.common).toEqual([]);
    expect(report.inbreedingCoefficient).toBe(0);
  });

  it("puts half-siblings at 12.5%", () => {
    // Same sire, different dams — the textbook figure.
    const source = sourceOf({
      bull: { sire: "shared", dam: "bull-dam" },
      cow: { sire: "shared", dam: "cow-dam" },
      shared: {},
      "bull-dam": {},
      "cow-dam": {},
    });

    const report = relatedness(ref("bull"), ref("cow"), source);

    expect(report.inbreedingCoefficient).toBeCloseTo(0.125);
    expect(report.common.map((entry) => entry.name)).toEqual(["shared"]);
  });

  it("puts full siblings at 25%", () => {
    const source = sourceOf({
      bull: { sire: "sire", dam: "dam" },
      cow: { sire: "sire", dam: "dam" },
      sire: {},
      dam: {},
    });

    expect(relatedness(ref("bull"), ref("cow"), source).inbreedingCoefficient).toBeCloseTo(0.25);
  });

  it("puts first cousins at 6.25%", () => {
    // First cousins means their sires are *full* brothers — two shared
    // grandparents, each contributing (1/2)^5.
    const source = sourceOf({
      bull: { sire: "bull-sire" },
      cow: { sire: "cow-sire" },
      "bull-sire": { sire: "grandsire", dam: "granddam" },
      "cow-sire": { sire: "grandsire", dam: "granddam" },
      grandsire: {},
      granddam: {},
    });

    expect(relatedness(ref("bull"), ref("cow"), source).inbreedingCoefficient).toBeCloseTo(0.0625);
  });

  it("puts half-first-cousins at half that again", () => {
    // Sires that are only half-brothers share one grandparent, not two. The
    // distinction is exactly the kind a screen must not round away.
    const source = sourceOf({
      bull: { sire: "bull-sire" },
      cow: { sire: "cow-sire" },
      "bull-sire": { sire: "grandsire", dam: "one-granddam" },
      "cow-sire": { sire: "grandsire", dam: "other-granddam" },
      grandsire: {},
      "one-granddam": {},
      "other-granddam": {},
    });

    expect(relatedness(ref("bull"), ref("cow"), source).inbreedingCoefficient).toBeCloseTo(0.03125);
  });

  it("catches a bull bred to his own daughter", () => {
    // The closest pairing there is, and the one the ancestor walk cannot see:
    // an animal never appears in its own ancestor list.
    const source = sourceOf({
      bull: {},
      daughter: { sire: "bull", dam: "unrelated" },
      unrelated: {},
    });

    const report = relatedness(ref("bull"), ref("daughter"), source);

    expect(report.inbreedingCoefficient).toBeCloseTo(0.25);
    expect(report.common.map((entry) => entry.name)).toEqual(["bull"]);
  });

  it("counts both routes when one ancestor appears twice on a side", () => {
    // Line breeding puts the same bull in two places, and each route is its
    // own term. Taking the shortest would understate exactly the pedigrees
    // where the number matters.
    const doubled = sourceOf({
      bull: { sire: "linebred", dam: "linebred-too" },
      linebred: { sire: "founder" },
      "linebred-too": { sire: "founder" },
      cow: { sire: "founder" },
      founder: {},
    });

    const single = sourceOf({
      bull: { sire: "linebred", dam: "plain" },
      linebred: { sire: "founder" },
      plain: {},
      cow: { sire: "founder" },
      founder: {},
    });

    expect(relatedness(ref("bull"), ref("cow"), doubled).inbreedingCoefficient).toBeGreaterThan(
      relatedness(ref("bull"), ref("cow"), single).inbreedingCoefficient,
    );
  });

  it("stops at the generation it was asked for", () => {
    const source = sourceOf({
      bull: { sire: "b1" },
      b1: { sire: "b2" },
      b2: { sire: "b3" },
      b3: { sire: "deep" },
      cow: { sire: "c1" },
      c1: { sire: "c2" },
      c2: { sire: "c3" },
      c3: { sire: "deep" },
      deep: {},
    });

    // The shared ancestor is four up on each side.
    expect(relatedness(ref("bull"), ref("cow"), source, 3).common).toEqual([]);
    expect(relatedness(ref("bull"), ref("cow"), source, 4).common).toHaveLength(1);
  });

  it("says the pedigree is thin rather than reporting a clean bill", () => {
    // "No common ancestors" out of two animals with no recorded parents is
    // silence, not reassurance, and the screen has to be able to tell.
    const source = sourceOf({ bull: {}, cow: {} });

    expect(relatedness(ref("bull"), ref("cow"), source).pedigreeIncomplete).toBe(true);
  });

  it("survives a pedigree that loops back on itself", () => {
    const source = sourceOf({ a: { sire: "b" }, b: { sire: "a" }, cow: {} });

    expect(() => relatedness(ref("a"), ref("cow"), source)).not.toThrow();
  });
});

describe("what to say about a coefficient", () => {
  it("escalates through the thresholds breeders actually work to", () => {
    expect(relatednessVerdict(0).level).toBe("clear");
    expect(relatednessVerdict(0.02).level).toBe("clear");
    expect(relatednessVerdict(0.0625).level).toBe("note");
    expect(relatednessVerdict(0.125).level).toBe("caution");
    expect(relatednessVerdict(0.25).level).toBe("refuse");
  });

  it("names the relationship rather than only the number", () => {
    expect(relatednessVerdict(0.125).summary).toMatch(/half-sibling/i);
    expect(relatednessVerdict(0.25).summary).toMatch(/parent-offspring|full-sibling/i);
  });
});
