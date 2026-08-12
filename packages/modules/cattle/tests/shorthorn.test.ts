import { describe, expect, it } from "vitest";

import { parseDigitalBeefPage, parsePedigreeEntry } from "../src/domain/parsers/digital-beef.js";
import { parseShorthornPercent } from "../src/domain/parsers/page.js";
import { SHORTHORN_CARRIER_PAGE, SHORTHORN_PAGE } from "./fixtures/shorthorn-pages.js";

/**
 * What a Shorthorn page does that the other two do not (spec §5.2).
 *
 * Two things, and both were bugs before they were features. Its percentage
 * field is a register code glued to a number, which an earlier reading turned
 * into a breed called AR; and every ancestor gets a second line carrying
 * colour, date of birth and breeder, which an earlier reading filed as an
 * animal of its own.
 */

const read = (page: string, registration: string) =>
  parseDigitalBeefPage(page, { association: "ASA", registration });

const at = (animal: ReturnType<typeof read>, position: string) =>
  animal.ancestors.find((ancestor) => ancestor.position === position);

describe("the Shorthorn percentage field", () => {
  it("reads the number as the Shorthorn share, whatever prefixes it", () => {
    // `AR50` is half Shorthorn recorded in the AR register, not half of a
    // breed called AR. The field is labelled *Shorthorn %*.
    expect(parseShorthornPercent("SH100")).toEqual({ percent: 100, register: "SH" });
    expect(parseShorthornPercent("AR50")).toEqual({ percent: 50, register: "AR" });
    expect(parseShorthornPercent("AR25")).toEqual({ percent: 25, register: "AR" });
    expect(parseShorthornPercent("0")).toEqual({ percent: 0 });
    expect(parseShorthornPercent("50%")).toEqual({ percent: 50 });
    expect(parseShorthornPercent("Purebred")).toBeUndefined();
  });

  it("becomes a makeup and a class on the animal", () => {
    const animal = read(SHORTHORN_PAGE, "4219133");

    expect(animal.breedComposition).toEqual([{ breed: "SH", percent: 100 }]);
    // The register code is the only place this template states a class.
    expect(animal.classification).toBe("SH");
  });
});

describe("the Shorthorn detail panel", () => {
  it("reads the horn status off the field that holds it", () => {
    // An earlier version searched for "Horned" and "Polled" as labels and
    // returned "SHORTHORNS", off a breeder's name four hundred lines away.
    expect(read(SHORTHORN_PAGE, "4219133").hornStatus).toBe("Scurred");
  });

  it("reads the tattoo despite the stray colon on the end of the label", () => {
    expect(read(SHORTHORN_PAGE, "4219133").tattoo).toBe("204C");
  });
});

describe("a Shorthorn pedigree line", () => {
  it("keeps the registry's flags on the number as printed", () => {
    // `*`, `x` and `s` are how Shorthorn records what kind of entry it is.
    // They stay, because the number as printed is what somebody checks
    // against the paper in the drawer.
    expect(parsePedigreeEntry("*sxAR30383        [ 0016 ]        OCC LUSTRE 0016", "")).toMatchObject(
      { regNumber: "*sxAR30383", name: "OCC LUSTRE 0016" },
    );
  });

  it("reads the second line as colour and birth date, not as an animal", () => {
    const animal = read(SHORTHORN_PAGE, "4219133");

    expect(animal.ancestors).toHaveLength(30);
    expect(at(animal, "sire")).toMatchObject({
      name: "JAKE'S PROUD JAZZ 266L",
      colour: "Roan",
      dob: "09/04/2001",
      breeder: "JACOB T OHLDE",
    });
    // On a pedigree reaching back to 1955 this is the only record of that
    // coat that exists anywhere, and it is half of what the colour prediction
    // needs.
    expect(at(animal, "sire's sire's sire's sire")).toMatchObject({
      name: "CORONET MAX LEADER",
      colour: "Roan",
      dob: "09/22/1955",
    });
  });
});

describe("the carrier page", () => {
  it("reads a carrier as a carrier", () => {
    // `THC` — tibial hemimelia, carrier by test. Every other page checked in
    // here reads THF, so until this one nothing proved the suffix was read.
    const animal = read(SHORTHORN_CARRIER_PAGE, "4094372");
    const improver = [...animal.ancestors, ...animal.unplacedAncestors].find(
      (entry) => entry.name === "DEERPARK IMPROVER 57",
    );

    expect(improver?.geneticTests).toContainEqual(
      expect.objectContaining({ defect: "TH", status: "carrier" }),
    );
    expect(improver?.geneticTests).toContainEqual(
      expect.objectContaining({ defect: "PHA", status: "free" }),
    );
  });

  it("still reads the whole chart on that page", () => {
    const animal = read(SHORTHORN_CARRIER_PAGE, "4094372");

    expect(animal.ancestors).toHaveLength(30);
    expect(at(animal, "sire")?.name).toBe("CF TRUMP X");
    expect(at(animal, "dam")?.name).toBe("NPS DESERT ROSE 004");
  });
});
