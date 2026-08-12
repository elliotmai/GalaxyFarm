import { describe, expect, it } from "vitest";

import {
  carriedDefects,
  herdRuleVerdict,
  matingAllowed,
  matingDefectRisk,
  statusOf,
  untestedDefects,
  type GeneticTest,
} from "../src/domain/genetics.js";

/**
 * The defect rules (§5.2).
 *
 * The thing worth testing here is not the arithmetic — it is the two places
 * where a plausible simplification would let a defect into the herd: treating
 * untested as free, and waiting for both sides to carry before saying
 * anything.
 */

const test = (defect: GeneticTest["defect"], status: GeneticTest["status"]): GeneticTest => ({
  defect,
  status,
});

const FREE_OF_ALL: GeneticTest[] = [test("TH", "free"), test("PHA", "free"), test("DS", "free")];

describe("defect status", () => {
  it("reads nothing recorded as untested rather than as free", () => {
    // The whole risk on this place is an untested animal out of a carrier
    // line. Defaulting to free is how one gets bought.
    expect(statusOf([], "TH")).toBe("untested");
  });

  it("counts an affected animal as carrying it, because it does", () => {
    expect(carriedDefects([test("PHA", "affected")])).toEqual(["PHA"]);
  });

  it("does not count free-by-parentage as carrying", () => {
    expect(carriedDefects([test("TH", "free_by_parentage")])).toEqual([]);
  });
});

describe("the house rule", () => {
  it("passes an animal free of all three", () => {
    expect(herdRuleVerdict(FREE_OF_ALL)).toEqual({ clean: true, carried: [], untested: [] });
  });

  it("fails a carrier, not only an affected animal", () => {
    // Carrier × free produces no affected calves, so the genetics alone would
    // permit this animal. The owner's rule is stricter on purpose.
    const verdict = herdRuleVerdict([
      test("TH", "carrier"),
      test("PHA", "free"),
      test("DS", "free"),
    ]);

    expect(verdict.clean).toBe(false);
    expect(verdict.carried).toEqual(["TH"]);
  });

  it("fails an untested animal without calling it a carrier", () => {
    const verdict = herdRuleVerdict([test("TH", "free")]);

    expect(verdict.clean).toBe(false);
    expect(verdict.carried).toEqual([]);
    expect(verdict.untested).toEqual(["PHA", "DS"]);
  });

  it("ignores defects outside the rule when saying what is untested", () => {
    // A bull free of TH, PHA and DS and untested for osteopetrosis meets the
    // rule as written. Reporting him as untested would bar an animal that
    // passes.
    expect(untestedDefects(FREE_OF_ALL)).toEqual([]);
  });
});

describe("what a pairing risks", () => {
  it("puts carrier by carrier at a quarter affected and a half carrier", () => {
    const [risk] = matingDefectRisk([test("TH", "carrier")], [test("TH", "carrier")], ["TH"]);

    expect(risk?.affectedChance).toBeCloseTo(0.25);
    expect(risk?.carrierChance).toBeCloseTo(0.75);
  });

  it("puts carrier by free at nothing affected and half carriers", () => {
    const [risk] = matingDefectRisk([test("PHA", "carrier")], [test("PHA", "free")], ["PHA"]);

    expect(risk?.affectedChance).toBe(0);
    expect(risk?.carrierChance).toBeCloseTo(0.5);
  });

  it("has an affected animal passing it every time", () => {
    const [risk] = matingDefectRisk([test("DS", "affected")], [test("DS", "carrier")], ["DS"]);

    expect(risk?.affectedChance).toBeCloseTo(0.5);
    expect(risk?.carrierChance).toBe(1);
  });

  it("says nothing at all about two free animals", () => {
    expect(matingDefectRisk(FREE_OF_ALL, FREE_OF_ALL, ["TH", "PHA", "DS"])).toEqual([]);
  });

  it("reports an untested side as uncertain rather than as safe", () => {
    const [risk] = matingDefectRisk([test("TH", "free")], [], ["TH"]);

    expect(risk?.uncertain).toBe(true);
    expect(risk?.affectedChance).toBe(0);
  });
});

describe("whether the pairing is allowed", () => {
  it("allows two clean animals", () => {
    expect(matingAllowed(FREE_OF_ALL, FREE_OF_ALL).allowed).toBe(true);
  });

  it("refuses on one carrier, without waiting for the second", () => {
    const verdict = matingAllowed([test("TH", "carrier")], FREE_OF_ALL);

    expect(verdict.allowed).toBe(false);
    expect(verdict.carried).toEqual(["TH"]);
  });

  it("flags an untested side without refusing it", () => {
    // The fix here is a hair card, not a different bull, and refusing outright
    // would stop work over paperwork.
    const verdict = matingAllowed(FREE_OF_ALL, [test("TH", "free")]);

    expect(verdict.allowed).toBe(true);
    expect(verdict.untested).toEqual(["PHA", "DS"]);
  });
});
