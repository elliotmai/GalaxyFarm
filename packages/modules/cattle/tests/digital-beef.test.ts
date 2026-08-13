import { describe, expect, it } from "vitest";

import { parseDigitalBeefPage, parseDigitalBeefUrl } from "../src/domain/parsers/digital-beef.js";
import {
  parseAncestorDetail,
  parseComposition,
  parseDefectCode,
  splitParent,
  type ImportedAnimal,
} from "../src/domain/parsers/page.js";
import { CHIANINA_PAGE } from "./fixtures/chianina-pages.js";
import { MAINE_ANJOU_PAGE } from "./fixtures/maine-anjou-pages.js";
import { SHORTHORN_PAGE } from "./fixtures/shorthorn-pages.js";

/**
 * The engine the three associations share (spec §5.2).
 *
 * What each of them does *differently* is checked in its own file —
 * `chianina.test.ts`, `maine-anjou.test.ts`, `shorthorn.test.ts`. What is here
 * is what has to hold on all three at once, which is the more interesting half:
 * a rule that works on one page and not the others is not a rule, it is a
 * coincidence that has not been caught yet.
 *
 * Every assertion was written after reading the real page. The first version of
 * this parser passed a suite of invented fixtures and then, on a real page,
 * read the animal's sex as "Bull Sire: MA364424 CMAC TYSON ET", the horn status
 * of a Shorthorn as "SHORTHORNS", and filed the navigation tab strip as three
 * generations of ancestors. Fixtures that agree with the parser prove nothing.
 */

const read = (page: string, association: "AMAA" | "ACA" | "ASA", registration: string) =>
  parseDigitalBeefPage(page, { association, registration });

const at = (animal: ImportedAnimal, position: string) =>
  animal.ancestors.find((ancestor) => ancestor.position === position);

const everyPage = () => [
  read(CHIANINA_PAGE, "ACA", "359968"),
  read(MAINE_ANJOU_PAGE, "AMAA", "402303"),
  read(SHORTHORN_PAGE, "ASA", "4219133"),
];

describe("the address", () => {
  it("says which registry the numbers belong to", () => {
    const parsed = parseDigitalBeefUrl(
      "https://shorthorn.digitalbeef.com/modules.php?op=modload&name=_animal&file=_animal&animal_registration=4219133",
    );

    expect(parsed).toMatchObject({
      ok: true,
      ref: { association: "ASA", registration: "4219133" },
    });
  });

  it("refuses a host it does not know rather than guessing", () => {
    // A number filed under the wrong registry is worse than no number: a
    // registration means nothing apart from the registry that issued it.
    const parsed = parseDigitalBeefUrl(
      "https://angus.digitalbeef.com/modules.php?animal_registration=1",
    );

    expect(parsed.ok).toBe(false);
  });
});

describe("the detail panel", () => {
  it("stops a value where the next column's label starts", () => {
    // The panel is two columns, so the flattened row reads
    // `Sex: Bull   Sire: MA364424 CMAC TYSON ET`. Reading to the end of the
    // line gives the sire's name as the animal's sex — which is what the
    // owner saw on the first real page he tried.
    const animal = read(CHIANINA_PAGE, "ACA", "359968");

    expect(animal.sex).toBe("Bull");
    expect(animal.name).toBe("ZNT MONTEGO BAY 901W");
    expect(animal.dob).toBe("06/19/2009");
    expect(animal.colour).toBe("Black");
  });

  it("finds the horn status on all three, which spell it the same way", () => {
    expect(read(CHIANINA_PAGE, "ACA", "359968").hornStatus).toBe("Polled");
    expect(read(MAINE_ANJOU_PAGE, "AMAA", "402303").hornStatus).toBe("Polled");
    expect(read(SHORTHORN_PAGE, "ASA", "4219133").hornStatus).toBe("Scurred");
  });

  it("finds a tattoo on all three, which do not spell it the same way", () => {
    // Chianina splits it across two cells, Maine-Anjou prints it whole under
    // an ear, Shorthorn under "Tattoo - LE". Each breed's file owns its own
    // reading; this is the check that all three arrive.
    expect(everyPage().map((animal) => animal.tattoo)).toEqual(["ZNT901W", "ZNT901W", "204C"]);
  });

  it("takes the parents from the panel, where they are named outright", () => {
    const animal = read(CHIANINA_PAGE, "ACA", "359968");

    expect(animal.sire).toEqual({ regNumber: "MA364424", name: "CMAC TYSON ET" });
    expect(animal.dam).toEqual({ regNumber: "337003", name: "ZNT JENNA 707T" });
  });

  it("finds every field it looks for on all three", () => {
    for (const animal of everyPage()) {
      expect(animal.missing).toEqual([]);
    }
  });
});

describe("the pedigree chart", () => {
  it("does not read the navigation tabs as ancestors", () => {
    // Anchored on "5-Generation Pedigree", not on the first mention of the
    // word — the page has a tab strip above the chart with a Pedigree tab on
    // it, and starting there files "tab left" as a grandsire.
    for (const animal of everyPage()) {
      const names = [...animal.ancestors, ...animal.unplacedAncestors].map(
        (ancestor) => ancestor.name ?? "",
      );
      expect(names.some((name) => /tab (left|right)|^DNA$|^Breeding$/i.test(name))).toBe(false);
    }
  });

  it("reads the same bull off two association pages into the same shape", () => {
    // The point of the whole exercise: two registries, two sets of numbers,
    // one animal. The slots have to agree or nothing downstream can join them.
    const chianina = read(CHIANINA_PAGE, "ACA", "359968");
    const maine = read(MAINE_ANJOU_PAGE, "AMAA", "402303");

    expect(at(chianina, "dam")?.name).toBe(at(maine, "dam")?.name);
    expect(at(chianina, "dam")?.regNumber).toBe("337003");
    expect(at(maine, "dam")?.regNumber).toBe("378987");
    expect(at(chianina, "sire's sire")?.name).toBe(at(maine, "sire's sire")?.name);
  });
});

describe("the defect flags", () => {
  it("reads Chianina's dashed list and Shorthorn's bare one alike", () => {
    expect(parseDefectCode("THF")).toMatchObject({ defect: "TH", status: "free" });
    expect(parseDefectCode("PHAFT")).toMatchObject({ defect: "PHA", status: "free" });
    expect(parseDefectCode("THC")).toMatchObject({ defect: "TH", status: "carrier" });
    expect(parseDefectCode("DDS")).toMatchObject({ defect: "DD", status: "suspect" });
  });

  it("keeps free-by-test and free-by-pedigree apart", () => {
    expect(parseDefectCode("PHAFP")).toMatchObject({ status: "free_by_parentage" });
  });

  it("calls a suffix it does not recognise suspect, never free", () => {
    // On a place whose house rule is that no carrier comes onto it, rounding
    // an unrecognised code down to "fine" is the one failure that matters.
    expect(parseDefectCode("AMS")).toMatchObject({ defect: "AM", status: "suspect" });
  });

  it("ignores a word that is not a flag", () => {
    expect(parseDefectCode("ET")).toBeUndefined();
    expect(parseDefectCode("SIRE")).toBeUndefined();
  });

  it("carries a carrier through to the animal it belongs to", () => {
    const animal = read(CHIANINA_PAGE, "ACA", "359968");
    const flagged = [...animal.ancestors, ...animal.unplacedAncestors].filter(
      (ancestor) => ancestor.geneticTests.length > 0,
    );

    expect(flagged.length).toBeGreaterThan(0);
  });
});

describe("the odds and ends", () => {
  it("splits a parent into its number and its name", () => {
    expect(splitParent("MA364424 \t CMAC TYSON ET")).toEqual({
      regNumber: "MA364424",
      name: "CMAC TYSON ET",
    });
    expect(splitParent("CMAC TYSON ET")).toEqual({ name: "CMAC TYSON ET" });
  });

  it("reads a detail line whether or not it has every part", () => {
    expect(parseAncestorDetail("Red & White, 03/04/2000, NICK STEINKE")).toEqual({
      colour: "Red & White",
      dob: "03/04/2000",
      breeder: "NICK STEINKE",
    });
    expect(parseAncestorDetail("Red")).toEqual({ colour: "Red" });
  });

  it("reads a composition written as fractions", () => {
    expect(parseComposition("1/2 MA 1/4 CH 1/4 SH")).toEqual([
      { breed: "MA", percent: 50 },
      { breed: "CH", percent: 25 },
      { breed: "SH", percent: 25 },
    ]);
  });

  it("returns a composition that does not add up as it was found", () => {
    // Correcting it would be a guess about which share was misread, and the
    // person looking at the preview is better placed to make that guess.
    expect(parseComposition("50% MA 25% CH")).toEqual([
      { breed: "MA", percent: 50 },
      { breed: "CH", percent: 25 },
    ]);
  });
});
