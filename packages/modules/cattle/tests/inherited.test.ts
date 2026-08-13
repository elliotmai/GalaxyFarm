import { describe, expect, it } from "vitest";

import {
  carriedColour,
  describeCarried,
  inheritedDefects,
  possibleRoan,
  type AncestorTests,
} from "../src/domain/inherited.js";
import type { GeneticTest } from "../src/domain/genetics.js";

/**
 * What an untested animal inherits (spec §5.2).
 *
 * Most calves on this place will never be hair-tested and most will never be
 * papered. Their parents are, and that answers both questions that matter —
 * what a calf can carry and what it can throw — because a recessive it does
 * not have cannot appear in it, and one it does have came from a parent.
 *
 * The asymmetry is the whole design: **free is inherited only from certainty,
 * suspicion is inherited from anywhere.** Getting that backwards is how a
 * carrier gets called clean.
 */

const parent = (name: string, tests: GeneticTest[], generation = 1): AncestorTests => ({
  name,
  generation,
  tests,
});

const status = (result: ReturnType<typeof inheritedDefects>, defect: string) =>
  result.find((entry) => entry.defect === defect);

describe("defects an animal inherits", () => {
  it("calls a calf out of two free parents free by parentage", () => {
    const result = inheritedDefects(
      [],
      [
        parent("BULL", [{ defect: "TH", status: "free" }]),
        parent("COW", [{ defect: "TH", status: "free" }]),
      ],
    );

    expect(status(result, "TH")).toMatchObject({ status: "free_by_parentage", inherited: true });
  });

  it("will not call it free on one free parent", () => {
    // One free parent says nothing: the other side can still have passed it.
    const result = inheritedDefects(
      [],
      [parent("BULL", [{ defect: "TH", status: "free" }]), parent("COW", [])],
    );

    expect(status(result, "TH")?.status).toBe("untested");
    expect(status(result, "TH")?.because).toMatch(/only one parent/i);
  });

  it("calls a calf out of a carrier a possible carrier", () => {
    const result = inheritedDefects(
      [],
      [
        parent("BULL", [{ defect: "PHA", status: "carrier" }]),
        parent("COW", [{ defect: "PHA", status: "free" }]),
      ],
    );

    expect(status(result, "PHA")).toMatchObject({ status: "suspect", inherited: true });
    expect(status(result, "PHA")?.because).toMatch(/BULL carries it/);
  });

  it("follows a carrier three generations down", () => {
    // The association's own rule: a tested carrier inside three generations
    // makes a descendant a possible carrier, however many untested animals sit
    // in between.
    const result = inheritedDefects(
      [],
      [
        parent("SIRE", []),
        parent("DAM", []),
        parent("GRANDSIRE", [{ defect: "DS", status: "carrier" }], 3),
      ],
    );

    expect(status(result, "DS")?.status).toBe("suspect");
  });

  it("stops following past three generations", () => {
    const result = inheritedDefects(
      [],
      [parent("WAY BACK", [{ defect: "DS", status: "carrier" }], 4)],
    );

    expect(status(result, "DS")?.status).toBe("untested");
  });

  it("lets a carrier beat two free parents rather than hiding the contradiction", () => {
    // Two free parents cannot produce a carrier, so this is a parentage error
    // — and reporting it is better than quietly calling the animal free.
    const result = inheritedDefects(
      [],
      [
        parent("BULL", [{ defect: "TH", status: "free" }]),
        parent("COW", [{ defect: "TH", status: "free" }]),
        parent("GRANDDAM", [{ defect: "TH", status: "carrier" }], 2),
      ],
    );

    expect(status(result, "TH")?.status).toBe("suspect");
  });

  it("lets the animal's own test win, in either direction", () => {
    const clean = inheritedDefects(
      [{ defect: "TH", status: "free" }],
      [parent("BULL", [{ defect: "TH", status: "carrier" }])],
    );
    expect(status(clean, "TH")).toMatchObject({ status: "free", inherited: false });

    const carrier = inheritedDefects(
      [{ defect: "TH", status: "carrier" }],
      [
        parent("BULL", [{ defect: "TH", status: "free" }]),
        parent("COW", [{ defect: "TH", status: "free" }]),
      ],
    );
    expect(status(carrier, "TH")?.status).toBe("carrier");
  });

  it("says so plainly when there is nothing to go on", () => {
    expect(status(inheritedDefects([], []), "TH")).toMatchObject({
      status: "untested",
      because: "No parents on file.",
    });
  });
});

describe("what an animal can be carrying", () => {
  const black = { extension: ["ED", "ED"] as const };
  const blackCarryingRed = { extension: ["ED", "e"] as const };
  const red = { extension: ["e", "e"] as const };

  it("finds the red hiding behind a black coat", () => {
    // The whole reason this exists: a recessive is invisible. A black cow out
    // of a red-carrying bull looks exactly like one out of two homozygous
    // blacks, and the two throw different calves.
    const carried = carriedColour(blackCarryingRed, black);

    expect(carried?.carriesRed).toBe(0.5);
    expect(describeCarried(carried as never)).toMatch(/50%/);
  });

  it("knows a calf out of two red-carriers is certain to carry it if it is black", () => {
    // ED/ED, ED/e, ED/e, e/e. Seeing a black coat rules out the e/e, leaving
    // one in three homozygous and two in three carrying.
    const carried = carriedColour(blackCarryingRed, blackCarryingRed, { extension: "black" });

    expect(carried?.carriesRed).toBeCloseTo(2 / 3, 5);
  });

  it("uses the coat that was actually seen to rule genotypes out", () => {
    // A red calf is e/e however unlikely that was beforehand. That turns a
    // prediction into a deduction.
    const carried = carriedColour(blackCarryingRed, blackCarryingRed, { extension: "red" });

    expect(carried?.possible).toEqual([{ genotype: "e/e", chance: 1 }]);
    expect(carried?.carriesRed).toBe(0);
  });

  it("says a red animal does not carry red", () => {
    expect(carriedColour(red, red)?.carriesRed).toBe(0);
    expect(describeCarried(carriedColour(red, red) as never)).toBeUndefined();
  });

  it("says nothing at all rather than guessing when a parent is untyped", () => {
    expect(carriedColour(undefined, black)).toBeUndefined();
    expect(carriedColour(black, {})).toBeUndefined();
  });

  it("never claims roan is carried unseen", () => {
    // Roan is co-dominant: one copy shows. Suggesting it can hide would
    // suggest a test worth running that is not.
    const carried = carriedColour(
      { extension: ["ED", "ED"], roan: ["R", "r"] },
      { extension: ["ED", "ED"], roan: ["r", "r"] },
    );

    expect(carried?.carriesRoan).toBe(0);
  });

  it("lists the roan pairs a mating can throw", () => {
    expect(
      possibleRoan(
        { extension: ["ED", "ED"], roan: ["R", "r"] },
        { extension: ["ED", "ED"], roan: ["R", "r"] },
      ),
    ).toEqual([
      { genotype: "R/r", chance: 0.5 },
      { genotype: "R/R", chance: 0.25 },
      { genotype: "r/r", chance: 0.25 },
    ]);
  });
});
