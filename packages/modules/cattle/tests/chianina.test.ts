import { describe, expect, it } from "vitest";

import { parseDigitalBeefPage, parsePedigreeEntry } from "../src/domain/parsers/digital-beef.js";
import { CHIANINA_PAGE, CHIANINA_SPARSE_PAGE } from "./fixtures/chianina-pages.js";

/**
 * What a Chianina page does that the other two do not (spec §5.2).
 *
 * Every assertion was written after reading the real page. The first version
 * of this parser passed a suite of invented fixtures and then, on a real
 * Chianina page, read the animal's sex as "Bull Sire: MA364424 CMAC TYSON ET"
 * and filed the navigation tab strip as three generations of ancestors.
 * Fixtures that agree with the parser prove nothing.
 */

const read = (page: string, registration: string) =>
  parseDigitalBeefPage(page, { association: "ACA", registration });

const at = (animal: ReturnType<typeof read>, position: string) =>
  animal.ancestors.find((ancestor) => ancestor.position === position);

describe("the Chianina detail panel", () => {
  it("joins the herd prefix and the left ear into one tattoo", () => {
    // The template prints them in separate cells and expects a person to read
    // them together. Taking either on its own gives half a tattoo.
    expect(read(CHIANINA_PAGE, "359968").tattoo).toBe("ZNT901W");
  });

  it("prefers the full makeup over the single-breed percentage, though both are printed", () => {
    // The page carries `Chianina %: 3.72` *and* `Genetic Makeup: 3.72% CA |
    // 79.57% MA | ...`. Reading the first would file a bull who is 80%
    // Maine-Anjou as 3.72% Chianina and nothing else.
    const animal = read(CHIANINA_PAGE, "359968");

    expect(animal.breedComposition).toEqual([
      { breed: "CA", percent: 3.72 },
      { breed: "MA", percent: 79.57 },
      { breed: "AN", percent: 14.41 },
      { breed: "XX", percent: 2.3 },
    ]);
  });

  it("reads the makeup off the sparse page too", () => {
    expect(read(CHIANINA_SPARSE_PAGE, "319149").breedComposition).toEqual([
      { breed: "CA", percent: 6.44 },
      { breed: "MA", percent: 69.14 },
      { breed: "AN", percent: 23.82 },
      { breed: "XX", percent: 0.6 },
    ]);
  });

  it("keeps this registry's own classification code as printed", () => {
    // `1CM` here means something other than Maine-Anjou's `PB`, so it is kept
    // as written and never fed to the AMAA upgrading chart.
    expect(read(CHIANINA_PAGE, "359968").classification).toBe("1CM");
  });

  it("keeps the association's own inbreeding figure", () => {
    expect(read(CHIANINA_PAGE, "359968").coi).toBe(4.57);
  });
});

describe("a Chianina pedigree line", () => {
  it("reads number-then-name, with the tattoo last", () => {
    expect(
      parsePedigreeEntry("MA185219        JF WAR CHIEF         [ 38C JMAF ]", "sire"),
    ).toMatchObject({ regNumber: "MA185219", name: "JF WAR CHIEF", tattoo: "38C JMAF" });
  });

  it("reads an empty tattoo as no tattoo", () => {
    expect(parsePedigreeEntry("264745        FGJ HABANERO         [ ]", "")?.tattoo).toBeUndefined();
  });
});

describe("the Chianina chart", () => {
  it("holds the slot open where the chart has a gap in it", () => {
    // This chart records only two of the bull's dam's dam's four
    // grandparents. The blank rows are what say *which* two: closing them up
    // would make JAZX MAINE ANJOU 352 the dam's dam's sire, when she is the
    // dam's dam's dam.
    const animal = read(CHIANINA_PAGE, "359968");

    expect(at(animal, "dam's dam")?.name).toBe("JAZX AUDREY 352N");
    expect(at(animal, "dam's dam's dam")?.name).toBe("JAZX MAINE ANJOU 352");
    expect(at(animal, "dam's dam's sire")?.name).toBe("CTR SUCCESS 02K 2CA");
    expect(at(animal, "dam's dam's dam's sire")).toBeUndefined();
  });

  it("keeps three blank rows as three empty slots", () => {
    // ZNT TRIPLE X records one of his dam's dam's four grandparents, printed
    // as three blanks, the animal, three blanks. An earlier version squeezed
    // runs of blank lines down to one, which moved her two slots up and made
    // her the dam's dam's sire.
    const animal = read(CHIANINA_SPARSE_PAGE, "319149");

    expect(at(animal, "dam")?.name).toBe("JAZX AUDREY 352N");
    expect(at(animal, "dam's dam")?.name).toBe("JAZX MAINE ANJOU 352");
    expect(at(animal, "dam's dam's sire")).toBeUndefined();
  });
});
