import { describe, expect, it } from "vitest";

import { EXTENSION_ALLELES, ROAN_ALLELES } from "../src/domain/coat-colour.js";
import {
  describeLocus,
  predictCalfColour,
  inferCoat,
  readPhenotype,
  settledGenotype,
  type CoatInference,
} from "../src/domain/coat-inference.js";

/**
 * Working a coat genotype out rather than testing for one (spec §5.2).
 *
 * Nothing on this place is hair-tested for colour, and most of it does not need
 * to be. The assertions below are the genetics, not the implementation: a red
 * animal is `e/e`, a roan is `R/r`, and a black calf out of a red cow carries
 * red because she had nothing else to hand it.
 */

const extension = (inference: CoatInference) =>
  describeLocus(inference.extension, EXTENSION_ALLELES);
const roan = (inference: CoatInference) => describeLocus(inference.roan, ROAN_ALLELES);

const seen = (colour: string) => inferCoat({ observed: readPhenotype(colour) });

describe("reading a coat off what somebody wrote", () => {
  it("knows the three Shorthorn patterns apart", () => {
    expect(readPhenotype("Roan")).toEqual({ pattern: "roan" });
    expect(readPhenotype("Blue Roan")).toEqual({ base: "black", pattern: "roan" });
    expect(readPhenotype("Red Roan")).toEqual({ base: "red", pattern: "roan" });
    expect(readPhenotype("White")).toEqual({ pattern: "white" });
    expect(readPhenotype("Black")).toEqual({ base: "black", pattern: "solid" });
  });

  it("does not read a spotted animal as a white one", () => {
    // `Red & White` on a Shorthorn is patches of each. Roan is white hairs
    // mixed *through* the coat. Calling her white would make her r/r and every
    // calf out of her a roan that never arrives.
    expect(readPhenotype("Red & White")).toEqual({ base: "red", pattern: "solid" });
    expect(readPhenotype("Black and White")).toEqual({ base: "black", pattern: "solid" });
  });

  it("says nothing about a colour it does not recognise", () => {
    // Better to leave the locus to the parents than to guess at it.
    expect(readPhenotype("Smoky")).toEqual({});
    expect(readPhenotype(undefined)).toEqual({});
  });
});

describe("what the coat alone settles", () => {
  it("makes a red animal e/e outright", () => {
    const red = seen("Red");

    expect(extension(red)).toBe("e/e");
    expect(red.extension.settled).toBe(true);
    expect(red.carriesRed.verdict).toBe("no");
  });

  it("leaves a black animal's second allele open", () => {
    // Black hides red. That is the whole problem, and saying "ED/ED" here
    // would be inventing the answer somebody needs a test or a calf for.
    const black = seen("Black");

    expect(black.extension.settled).toBe(false);
    expect(extension(black)).not.toContain("e/e");
    expect(black.carriesRed.verdict).toBe("maybe");
  });

  it("settles all three roan phenotypes, because roan hides nothing", () => {
    // Co-dominant: three coats, three genotypes, no carriers to find.
    expect(roan(seen("Roan"))).toBe("R/r");
    expect(roan(seen("White"))).toBe("r/r");
    expect(roan(seen("Black"))).toBe("R/R");
  });

  it("names the coat when both loci are settled", () => {
    expect(seen("Red Roan").coat).toBe("red roan");
    expect(seen("Red").coat).toBe("red");
  });
});

describe("what the parents settle", () => {
  const red = seen("Red");
  const black = seen("Black");

  it("makes a black calf out of a red parent a known carrier", () => {
    // The case the owner asked for. She had only `e` to give, so he has one,
    // and nothing about his own coat will ever show it.
    const calf = inferCoat({ observed: readPhenotype("Black"), sire: black, dam: red });

    expect(calf.carriesRed.verdict).toBe("yes");
    expect(extension(calf)).toContain("/e");
  });

  it("makes a calf out of two red parents red, whatever anybody wrote down", () => {
    const calf = inferCoat({ sire: red, dam: red });

    expect(extension(calf)).toBe("e/e");
    expect(calf.extension.settled).toBe(true);
  });

  it("gives the odds a black calf out of two carriers is hiding red", () => {
    // A quarter of the calves are red, a half carry, a quarter are clear. Of
    // the three that are *black*, two carry — and two-thirds is the number
    // that decides whether a heifer is worth testing before a red bull.
    const carrier = inferCoat({ tested: { extension: ["E", "e"] } });
    const calf = inferCoat({
      observed: readPhenotype("Black"),
      sire: carrier,
      dam: carrier,
    });

    expect(calf.carriesRed.chance).toBeCloseTo(2 / 3, 5);
  });

  it("puts no number on an animal whose own coat nobody wrote down", () => {
    // "Hiding red" means hiding it behind a dark coat. On an animal that might
    // be red there is no question to answer, and a percentage would be
    // answering a different one than the label says.
    const carrier = inferCoat({ tested: { extension: ["E", "e"] } });
    const calf = inferCoat({ sire: carrier, dam: carrier });

    expect(calf.carriesRed.verdict).toBe("maybe");
    expect(calf.carriesRed.chance).toBeUndefined();
  });

  it("is exact even where the parents' own pairs are not", () => {
    // Each parent is `ED/e` or `E/e` — nobody knows which, and it does not
    // matter: both hand `e` down half the time. Refusing to answer because
    // the pair is unsettled would throw away a number that is not in doubt.
    const carrier = inferCoat({
      observed: readPhenotype("Black"),
      progeny: [readPhenotype("Red")],
    });
    expect(carrier.extension.settled).toBe(false);

    const calf = inferCoat({
      observed: readPhenotype("Black"),
      sire: carrier,
      dam: carrier,
    });

    expect(calf.carriesRed.chance).toBeCloseTo(2 / 3, 5);
  });

  it("refuses to put a number on a black animal with no pedigree", () => {
    // It could be any of four pairs. Calling each of them a quarter would be
    // inventing a prior out of nothing and printing it as a percentage.
    expect(seen("Black").extension.weighted).toBe(false);
    expect(seen("Black").carriesRed.chance).toBeUndefined();
  });

  it("gets red out of two black parents when both carry it", () => {
    const carrier = inferCoat({ tested: { extension: ["ED", "e"] } });
    const calf = inferCoat({ observed: readPhenotype("Red"), sire: carrier, dam: carrier });

    expect(extension(calf)).toBe("e/e");
  });
});

describe("what a calf proves about its parents", () => {
  it("makes a black cow with a red calf a known carrier", () => {
    // The way a carrier is actually found on a place that does not hair-test,
    // and the one piece of evidence that travels *up* a pedigree.
    const cow = inferCoat({
      observed: readPhenotype("Black"),
      progeny: [readPhenotype("Red")],
    });

    expect(cow.carriesRed.verdict).toBe("yes");
    expect(extension(cow)).toContain("/e");
  });

  it("agrees with itself when a roan cow throws a white calf", () => {
    // Roan is R/r, so an r is there to give. Nothing is narrowed and nothing
    // is contradicted.
    const cow = inferCoat({
      observed: readPhenotype("Roan"),
      progeny: [readPhenotype("White")],
    });

    expect(roan(cow)).toBe("R/r");
    expect(cow.roan.because.join(" ")).not.toContain("disagrees");
  });

  it("says so rather than silently rewriting a coat the calves contradict", () => {
    // A solid cow is R/R and has only R to give, so she cannot have a white
    // (r/r) calf. One of the two records is wrong, and the app is not the
    // thing that should decide which — it keeps what it had and says the two
    // disagree, so somebody goes and looks.
    const cow = inferCoat({
      observed: readPhenotype("Black"),
      progeny: [readPhenotype("White")],
    });

    expect(roan(cow)).toBe("R/R");
    expect(cow.roan.because.join(" ")).toContain("disagrees");
  });

  it("leaves an animal with no red calves where it was", () => {
    const cow = inferCoat({
      observed: readPhenotype("Black"),
      progeny: [readPhenotype("Black"), readPhenotype("Black")],
    });

    // Black calves prove nothing — a carrier throws them too.
    expect(cow.carriesRed.verdict).toBe("maybe");
  });
});

describe("a hair card", () => {
  it("wins over everything worked out", () => {
    // A test is not a deduction. If the card says ED/ED, the cow is ED/ED
    // whatever the pedigree on file implies.
    const tested = inferCoat({
      tested: { extension: ["ED", "ED"] },
      observed: readPhenotype("Black"),
      sire: seen("Red"),
      dam: seen("Red"),
    });

    expect(extension(tested)).toBe("ED/ED");
    expect(tested.carriesRed.verdict).toBe("no");
    expect(tested.extension.because).toEqual(["A hair card."]);
  });
});

describe("saying why", () => {
  it("gives the reasoning in words somebody would use", () => {
    const calf = inferCoat({
      observed: readPhenotype("Black"),
      sire: seen("Black"),
      dam: seen("Red"),
    });

    expect(calf.extension.because.join(" ")).toContain("One allele from each parent");
    expect(calf.extension.because.join(" ")).toContain("black");
  });

  it("hands back only what is settled, for anything that needs a real pair", () => {
    const roanRed = inferCoat({ observed: readPhenotype("Red Roan") });

    expect(settledGenotype(roanRed)).toEqual({ extension: ["e", "e"], roan: ["R", "r"] });
    expect(settledGenotype(seen("Black")).extension).toBeUndefined();
  });
});

describe("what colour the calf can be", () => {
  it("works off inferred parents, with no hair card anywhere", () => {
    // The point of the exercise. A red cow is e/e whether or not anybody paid
    // a lab to say so, and a planner that needs a card for every pairing is
    // one nobody opens twice.
    const redCow = seen("Red");
    const blackBull = inferCoat({
      observed: readPhenotype("Black"),
      progeny: [readPhenotype("Red")],
    });

    const calf = predictCalfColour(blackBull, redCow);

    // He carries red and she is red, so half the calves are red.
    const red = calf.outcomes.find((outcome) => outcome.name === "red");
    expect(red?.chance).toBeCloseTo(0.5, 5);
    expect(calf.missing).toEqual([]);
  });

  it("gets the quarter right when neither parent's own pair is settled", () => {
    // Both are `ED/e` or `E/e` and nobody knows which. It does not matter —
    // each hands red down half the time, so a quarter of the calves are red.
    const carrier = inferCoat({
      observed: readPhenotype("Black"),
      progeny: [readPhenotype("Red")],
    });

    const calf = predictCalfColour(carrier, carrier);

    expect(calf.outcomes.find((outcome) => outcome.name === "red")?.chance).toBeCloseTo(0.25, 5);
    expect(calf.outcomes.find((outcome) => outcome.name === "black")?.chance).toBeCloseTo(0.75, 5);
  });

  it("names the coat both loci make, not one of each", () => {
    // Roan has no colour of its own — it takes the one Extension gave it, so
    // black through roan is a blue roan. Reporting the loci apart would say
    // "half black, half roan" about a mating where every calf is a blue roan.
    const blueRoan = seen("Blue Roan");
    const black = inferCoat({ tested: { extension: ["ED", "ED"], roan: ["R", "R"] } });

    const calf = predictCalfColour(black, blueRoan);

    expect(calf.outcomes.map((outcome) => outcome.name).sort()).toEqual(["black", "blue roan"]);
    expect(calf.outcomes.every((outcome) => outcome.chance === 0.5)).toBe(true);
  });

  it("gives all four when a carrier bull meets a red roan cow", () => {
    // The pairing the owner checked by hand: a black bull out of a red dam
    // (so `ED/e` or `E/e`, solid) over a red roan cow (`e/e`, `R/r`). Four
    // outcomes at a quarter each — red roan, red, blue roan, black.
    const bull = inferCoat({
      observed: readPhenotype("Black"),
      sire: seen("Black"),
      dam: seen("Red"),
    });
    const cow = seen("Red Roan");

    const calf = predictCalfColour(bull, cow);

    expect(
      Object.fromEntries(calf.outcomes.map((outcome) => [outcome.name, outcome.chance])),
    ).toEqual({
      "red roan": 0.25,
      red: 0.25,
      "blue roan": 0.25,
      black: 0.25,
    });
    expect(calf.missing).toEqual([]);
  });

  it("does not let a half-answer read as a whole one", () => {
    // Only the base can be worked out here. "black 50%" beside "red 50%"
    // looks exactly like a finished prediction — solid black or solid red —
    // when every one of those calves could still arrive roan.
    const carrier = inferCoat({
      observed: readPhenotype("Black"),
      progeny: [readPhenotype("Red")],
      // A hair card for Extension and nothing for roan: settled at one locus,
      // wide open at the other.
      tested: { extension: ["ED", "e"] },
    });
    const red = inferCoat({ tested: { extension: ["e", "e"] } });

    const calf = predictCalfColour(carrier, red);

    expect(calf.outcomes.map((outcome) => outcome.name).sort()).toEqual([
      "black — solid, roan or white",
      "red — solid, roan or white",
    ]);
    // The bull's coat settles his roan; the red cow here has a card for
    // Extension only, so hers is the pair nobody knows.
    expect(calf.missing.join(" ")).toContain("Solid, roan or white is open");
    expect(calf.missing.join(" ")).toContain("the dam's");
  });

  it("says which half of the answer is missing rather than half-answering", () => {
    // Two black animals with no pedigree: the pattern is settled by their
    // coats, the base is not.
    const calf = predictCalfColour(seen("Black"), seen("Black"));

    expect(calf.outcomes.map((outcome) => outcome.name)).toEqual(["solid — red or black"]);
    expect(calf.missing.join(" ")).toContain("Red or black is open");
  });

  it("never offers an outcome that cannot happen", () => {
    const red = seen("Red");
    const calf = predictCalfColour(red, red);

    expect(calf.outcomes.map((outcome) => outcome.name)).toEqual(["red"]);
  });

  it("names the side that is actually short, not both", () => {
    // A red roan cow is settled at both loci. If the bull is the one nobody
    // has recorded, saying "neither parent" sends somebody to the wrong
    // record — and a message pointing at the wrong record gets ignored.
    const cow = seen("Red Roan");
    const bull = inferCoat({});

    const calf = predictCalfColour(bull, cow);

    expect(calf.missing.join(" ")).toContain("the sire's");
    expect(calf.missing.join(" ")).not.toContain("neither parent");
  });

  it("gives four outcomes for the owner's own roan cow and carrier bull", () => {
    // Straight off the records that were on screen. The cow is roan out of two
    // parents who both came out solid — which is why this was wrong: her coat
    // was being discarded in favour of her parents, so she was forced to R/R
    // and every calf out of her came back solid.
    const cow = inferCoat({
      observed: readPhenotype("Roan"),
      // Her sire reads e/e on his own record, so his colour names red — he is
      // the red roan she got her roan from.
      sire: inferCoat({ observed: readPhenotype("Red Roan") }),
      dam: inferCoat({ observed: readPhenotype("Red") }),
    });
    const bull = inferCoat({
      observed: readPhenotype("Black"),
      sire: inferCoat({ observed: readPhenotype("Black") }),
      dam: inferCoat({ observed: readPhenotype("Red") }),
    });

    expect(roan(cow)).toBe("R/r");
    expect(roan(bull)).toBe("R/R");
    expect(extension(bull)).toBe("ED/e or E/e");

    const calf = predictCalfColour(bull, cow);

    expect(
      Object.fromEntries(calf.outcomes.map((outcome) => [outcome.name, outcome.chance])),
    ).toEqual({
      "red roan": 0.25,
      red: 0.25,
      "blue roan": 0.25,
      black: 0.25,
    });
  });

  it("keeps the coat and flags the pedigree when the two cannot both be true", () => {
    // A roan out of two solid parents. The coat is a fact about the animal in
    // front of you; the cross is a deduction resting on colours nobody
    // recorded and parent links that may be wrong. The deduction is the
    // unsafe half, and something in that pedigree needs looking at.
    const solid = seen("Black");
    const impossible = inferCoat({
      observed: readPhenotype("Roan"),
      sire: solid,
      dam: solid,
    });

    expect(roan(impossible)).toBe("R/r");
    expect(impossible.roan.because.join(" ")).toContain("cannot account for that coat");
  });
});
