import { describe, expect, it } from "vitest";

import {
  carriesRed,
  coatName,
  predictColour,
  punnett,
  readExtension,
  readRoan,
  writeExtension,
  type ExtensionAllele,
  type RoanAllele,
} from "../src/domain/coat-colour.js";

/**
 * Coat colour (§5.2).
 *
 * Every case here is one a Shorthorn breeder already knows the answer to,
 * which is the point: red × white gives all roan, roan × roan gives a quarter
 * of each, and a black bull carrying red over a red roan cow gives four
 * colours in equal parts. If this file agrees with the barn, the model is
 * telling the truth; if it disagrees, the barn is right.
 */

const ext = (a: ExtensionAllele, b: ExtensionAllele) => [a, b] as const;
const roan = (a: RoanAllele, b: RoanAllele) => [a, b] as const;

const chanceOf = (outcomes: readonly { label: string; chance: number }[], label: string) =>
  outcomes.find((outcome) => outcome.label === label)?.chance ?? 0;

describe("one locus at a time", () => {
  it("makes four cells, whatever the alleles", () => {
    expect(punnett(ext("ED", "e"), ext("e", "e")).flat()).toHaveLength(4);
  });

  it("has a red-carrying black look exactly like a homozygous one", () => {
    // Which is the entire problem: you cannot tell them apart by looking, and
    // out of a red bull they produce different calf crops.
    expect(carriesRed(ext("ED", "e"))).toBe(true);
    expect(carriesRed(ext("ED", "ED"))).toBe(false);
  });

  it("writes a genotype dominant-first, the way a hair card prints it", () => {
    expect(writeExtension(ext("e", "ED"))).toBe("ED/e");
  });

  it("reads a genotype back, and refuses anything that is not one", () => {
    expect(readExtension("ED/e")).toEqual(["ED", "e"]);
    expect(readRoan("R/r")).toEqual(["R", "r"]);
    expect(readExtension("black")).toBeUndefined();
    expect(readRoan("R")).toBeUndefined();
  });
});

describe("the two loci together", () => {
  it("names black through roan a blue roan", () => {
    expect(coatName(ext("ED", "ED"), roan("R", "r"))).toBe("blue roan");
  });

  it("names red through roan a red roan", () => {
    expect(coatName(ext("e", "e"), roan("R", "r"))).toBe("red roan");
  });

  it("keeps the base colour in the points of a white animal", () => {
    // A white Shorthorn out of black stock has dark ears and a dark nose, and
    // that is what distinguishes her from a white Chianina on paper.
    expect(coatName(ext("ED", "e"), roan("r", "r"))).toBe("white, dark points");
    expect(coatName(ext("e", "e"), roan("r", "r"))).toBe("white, red points");
  });
});

describe("what a pairing throws", () => {
  it("gives all roan from a solid red bull over a white cow", () => {
    // The oldest fact in the Shorthorn book.
    const { outcomes } = predictColour(
      { extension: ext("e", "e"), roan: roan("R", "R") },
      { extension: ext("e", "e"), roan: roan("r", "r") },
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.label).toBe("red roan");
    expect(outcomes[0]?.chance).toBe(1);
  });

  it("gives a quarter solid, half roan, quarter white from roan by roan", () => {
    const { outcomes } = predictColour(
      { extension: ext("e", "e"), roan: roan("R", "r") },
      { extension: ext("e", "e"), roan: roan("R", "r") },
    );

    expect(chanceOf(outcomes, "red")).toBeCloseTo(0.25);
    expect(chanceOf(outcomes, "red roan")).toBeCloseTo(0.5);
    expect(chanceOf(outcomes, "white, red points")).toBeCloseTo(0.25);
  });

  it("gives four colours in equal parts from a red roan cow and a black bull carrying red", () => {
    // The owner's own example. A solid black bull that carries red, over a red
    // roan cow: a quarter each of black, blue roan, red and red roan.
    const { outcomes } = predictColour(
      { extension: ext("ED", "e"), roan: roan("R", "R") },
      { extension: ext("e", "e"), roan: roan("R", "r") },
    );

    expect(chanceOf(outcomes, "black")).toBeCloseTo(0.25);
    expect(chanceOf(outcomes, "blue roan")).toBeCloseTo(0.25);
    expect(chanceOf(outcomes, "red")).toBeCloseTo(0.25);
    expect(chanceOf(outcomes, "red roan")).toBeCloseTo(0.25);
  });

  it("throws no red at all when the black bull does not carry it", () => {
    // Same cow, a homozygous black bull: every calf is dark, and half are
    // blue roan. This is the pair the model has to tell apart.
    const { outcomes } = predictColour(
      { extension: ext("ED", "ED"), roan: roan("R", "R") },
      { extension: ext("e", "e"), roan: roan("R", "r") },
    );

    expect(chanceOf(outcomes, "red")).toBe(0);
    expect(chanceOf(outcomes, "red roan")).toBe(0);
    expect(chanceOf(outcomes, "black")).toBeCloseTo(0.5);
    expect(chanceOf(outcomes, "blue roan")).toBeCloseTo(0.5);
  });

  it("marks the dark calves that carry red", () => {
    const { outcomes } = predictColour(
      { extension: ext("ED", "e"), roan: roan("R", "R") },
      { extension: ext("e", "e"), roan: roan("R", "R") },
    );

    expect(outcomes.find((outcome) => outcome.label === "black")?.carriesRed).toBe(true);
  });

  it("says which locus it could not predict rather than guessing it", () => {
    const prediction = predictColour(
      { extension: ext("ED", "e") },
      { extension: ext("e", "e"), roan: roan("R", "r") },
    );

    expect(prediction.missing).toEqual(["Roan (solid, roan or white)"]);
    // The locus it does know still gets reported.
    expect(chanceOf(prediction.outcomes, "red")).toBeCloseTo(0.5);
  });

  it("always states what it does not model", () => {
    // A prediction that looks complete and silently omits dilution and
    // spotting is worse than one that names its own edges.
    const { caveats } = predictColour({}, {});

    expect(caveats.join(" ")).toMatch(/dilution/i);
    expect(caveats.join(" ")).toMatch(/white face/i);
  });
});
