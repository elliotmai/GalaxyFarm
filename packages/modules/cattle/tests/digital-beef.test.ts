import { describe, expect, it } from "vitest";

import {
  parseAncestorDetail,
  parseComposition,
  parseDefectCode,
  parseDigitalBeefPage,
  parseDigitalBeefUrl,
  parsePedigreeEntry,
  splitParent,
  type ImportedAnimal,
} from "../src/domain/digital-beef.js";
import {
  CHIANINA_PAGE,
  MAINE_ANJOU_PAGE,
  SHORTHORN_PAGE,
} from "./fixtures/digital-beef-pages.js";

/**
 * The Digital Beef importer, against pages that actually exist (spec §5.2).
 *
 * Every assertion below was written after reading the real page, not before.
 * The first version of this parser passed a suite of invented fixtures and
 * then, on a real Chianina page, read the animal's sex as "Bull Sire: MA364424
 * CMAC TYSON ET", the horn status of a Shorthorn as "SHORTHORNS", and filed
 * the navigation tab strip as three generations of ancestors. Fixtures that
 * agree with the parser prove nothing.
 */

const read = (page: string, association: "AMAA" | "ACA" | "ASA", registration: string) =>
  parseDigitalBeefPage(page, { association, registration });

const at = (animal: ImportedAnimal, position: string) =>
  animal.ancestors.find((ancestor) => ancestor.position === position);

describe("the address", () => {
  it("says which registry the numbers belong to", () => {
    const parsed = parseDigitalBeefUrl(
      "https://shorthorn.digitalbeef.com/modules.php?op=modload&name=_animal&file=_animal&animal_registration=4219133",
    );

    expect(parsed).toMatchObject({ ok: true, ref: { association: "ASA", registration: "4219133" } });
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

  it("reads the horn status from the field that holds it", () => {
    // `Horn/Poll/Scur` is the only place any of the three records this. An
    // earlier version searched for "Horned" and "Polled" as labels and
    // returned "SHORTHORNS", off a breeder's name four hundred lines away.
    expect(read(CHIANINA_PAGE, "ACA", "359968").hornStatus).toBe("Polled");
    expect(read(MAINE_ANJOU_PAGE, "AMAA", "402303").hornStatus).toBe("Polled");
    expect(read(SHORTHORN_PAGE, "ASA", "4219133").hornStatus).toBe("Scurred");
  });

  it("finds the tattoo under all three spellings of it", () => {
    // Chianina splits it into a herd prefix and a left-ear number on two
    // lines, Maine-Anjou prints it whole under "Left Ear", Shorthorn calls it
    // "Tattoo - LE" and leaves a stray colon on the end.
    expect(read(CHIANINA_PAGE, "ACA", "359968").tattoo).toBe("ZNT901W");
    expect(read(MAINE_ANJOU_PAGE, "AMAA", "402303").tattoo).toBe("ZNT901W");
    expect(read(SHORTHORN_PAGE, "ASA", "4219133").tattoo).toBe("204C");
  });

  it("takes the parents from the panel, where they are named outright", () => {
    const animal = read(CHIANINA_PAGE, "ACA", "359968");

    expect(animal.sire).toEqual({ regNumber: "MA364424", name: "CMAC TYSON ET" });
    expect(animal.dam).toEqual({ regNumber: "337003", name: "ZNT JENNA 707T" });
  });

  it("reads the breed makeup in each association's spelling", () => {
    expect(read(CHIANINA_PAGE, "ACA", "359968").breedComposition).toEqual([
      { breed: "CA", percent: 3.72 },
      { breed: "MA", percent: 79.57 },
      { breed: "AN", percent: 14.41 },
      { breed: "XX", percent: 2.3 },
    ]);
    expect(read(SHORTHORN_PAGE, "ASA", "4219133").breedComposition).toEqual([
      { breed: "SH", percent: 100 },
    ]);
  });

  it("keeps the association's own inbreeding figure and the disposal date", () => {
    expect(read(CHIANINA_PAGE, "ACA", "359968").coi).toBe(4.57);

    const culled = read(MAINE_ANJOU_PAGE, "AMAA", "402303");
    expect(culled.status).toBe("Culled - Culled - age");
    expect(culled.disposedOn).toBe("03/17/2022");
  });

  it("finds every field it looks for on all three", () => {
    for (const animal of [
      read(CHIANINA_PAGE, "ACA", "359968"),
      read(MAINE_ANJOU_PAGE, "AMAA", "402303"),
      read(SHORTHORN_PAGE, "ASA", "4219133"),
    ]) {
      expect(animal.missing).toEqual([]);
    }
  });
});

describe("the pedigree chart", () => {
  it("reads a complete five-generation chart into all thirty slots", () => {
    const animal = read(MAINE_ANJOU_PAGE, "AMAA", "402303");

    expect(animal.ancestors).toHaveLength(30);
    expect(animal.unplacedAncestors).toEqual([]);
  });

  it("places by in-order position, which is how the chart is drawn", () => {
    // Digital Beef draws each animal vertically centred between its two
    // parents' subtrees, so the flattened chart is an in-order traversal.
    // These four are the check: JAZX MS 720G is the dam's dam's dam, out of
    // JAZX MS DESIGN 012D by DESIGNED BY SHOWTIME, and the names corroborate
    // the arithmetic.
    const animal = read(MAINE_ANJOU_PAGE, "AMAA", "402303");

    expect(at(animal, "dam")?.name).toBe("ZNT JENNA 707T");
    expect(at(animal, "dam's dam")?.name).toBe("JAZX AUDREY 352N");
    expect(at(animal, "dam's dam's dam")?.name).toBe("JAZX MS 720G");
    expect(at(animal, "dam's dam's dam's sire")?.name).toBe("DESIGNED BY SHOWTIME");
    expect(at(animal, "dam's dam's dam's dam")?.name).toBe("JAZX MS DESIGN 012D");
  });

  it("counts generations from the animal outwards", () => {
    const animal = read(MAINE_ANJOU_PAGE, "AMAA", "402303");

    expect(at(animal, "sire")?.generation).toBe(1);
    expect(at(animal, "sire's sire")?.generation).toBe(2);
    expect(at(animal, "sire's sire's dam")?.generation).toBe(3);
    expect(at(animal, "sire's sire's dam's dam")?.generation).toBe(4);
  });

  it("holds the slot open where the chart has a gap in it", () => {
    // The Chianina chart for this bull records only two of his dam's dam's
    // four grandparents. The blank rows are what say *which* two: closing
    // them up would make JAZX MAINE ANJOU 352 the dam's dam's sire, when she
    // is the dam's dam's dam.
    const animal = read(CHIANINA_PAGE, "ACA", "359968");

    expect(at(animal, "dam's dam")?.name).toBe("JAZX AUDREY 352N");
    expect(at(animal, "dam's dam's dam")?.name).toBe("JAZX MAINE ANJOU 352");
    expect(at(animal, "dam's dam's sire")?.name).toBe("CTR SUCCESS 02K 2CA");
    expect(at(animal, "dam's dam's dam's sire")).toBeUndefined();
  });

  it("does not read the navigation tabs as ancestors", () => {
    // Anchored on "5-Generation Pedigree", not on the first mention of the
    // word — the page has a tab strip above the chart with a Pedigree tab on
    // it, and starting there files "tab left" as a grandsire.
    for (const animal of [
      read(CHIANINA_PAGE, "ACA", "359968"),
      read(MAINE_ANJOU_PAGE, "AMAA", "402303"),
      read(SHORTHORN_PAGE, "ASA", "4219133"),
    ]) {
      const names = [...animal.ancestors, ...animal.unplacedAncestors].map(
        (ancestor) => ancestor.name ?? "",
      );
      expect(names.some((name) => /tab (left|right)|^DNA$|^Breeding$/i.test(name))).toBe(false);
    }
  });

  it("reads Shorthorn's second line as colour and birth date, not as an animal", () => {
    const animal = read(SHORTHORN_PAGE, "ASA", "4219133");

    expect(animal.ancestors).toHaveLength(30);
    expect(at(animal, "sire")).toMatchObject({
      name: "JAKE'S PROUD JAZZ 266L",
      colour: "Roan",
      dob: "09/04/2001",
      breeder: "JACOB T OHLDE",
    });
    expect(at(animal, "sire's sire's sire's sire")).toMatchObject({
      name: "CORONET MAX LEADER",
      colour: "Roan",
      dob: "09/22/1955",
    });
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
    expect(
      parsePedigreeEntry(
        "MA307184        COWAN'S ALI 4M         [ COWN4M ]    -- PHAF THF",
        "",
      )?.geneticTests,
    ).toEqual([
      { defect: "PHA", status: "free", notes: expect.stringContaining("PHAF") },
      { defect: "TH", status: "free", notes: expect.stringContaining("THF") },
    ]);

    expect(
      parsePedigreeEntry(
        "*xAR30384        [ 245B ]        OCC JAKE'S PRIDE 245B   DSC PHAF THF",
        "",
      )?.geneticTests,
    ).toEqual([
      { defect: "DS", status: "carrier", notes: expect.stringContaining("DSC") },
      { defect: "PHA", status: "free", notes: expect.anything() },
      { defect: "TH", status: "free", notes: expect.anything() },
    ]);
  });

  it("keeps free-by-test and free-by-pedigree apart", () => {
    expect(parseDefectCode("THFT")?.status).toBe("free");
    expect(parseDefectCode("THFP")?.status).toBe("free_by_parentage");
  });

  it("calls a suffix it does not recognise suspect, never free", () => {
    // The house rule is that no carrier comes onto the place. A code nobody
    // recognised being rounded down to "fine" is precisely how one would.
    expect(parseDefectCode("AMS")?.status).toBe("suspect");
    expect(parseDefectCode("DSP")?.status).toBe("suspect");
    expect(parseDefectCode("PHA")?.status).toBe("suspect");
  });

  it("ignores a word that is not a flag", () => {
    expect(parseDefectCode("ET")).toBeUndefined();
    expect(
      parsePedigreeEntry("MA276888        CMAC KATARINA ET         [ ]", "")?.name,
    ).toBe("CMAC KATARINA ET");
  });

  it("carries a carrier through to the animal it belongs to", () => {
    const animal = read(SHORTHORN_PAGE, "ASA", "4219133");

    expect(at(animal, "sire")?.geneticTests).toContainEqual(
      expect.objectContaining({ defect: "DS", status: "carrier" }),
    );
  });
});

describe("one ancestor line", () => {
  it("reads Chianina's number-then-name", () => {
    expect(
      parsePedigreeEntry("MA185219        JF WAR CHIEF         [ 38C JMAF ]", "sire"),
    ).toMatchObject({ regNumber: "MA185219", name: "JF WAR CHIEF", tattoo: "38C JMAF" });
  });

  it("reads Maine-Anjou's number-then-tattoo-then-name", () => {
    expect(
      parsePedigreeEntry("185219        [ 38C JMAF ]        JF WAR CHIEF   -- PHAFP THFP", "sire"),
    ).toMatchObject({ regNumber: "185219", name: "JF WAR CHIEF", tattoo: "38C JMAF" });
  });

  it("keeps Shorthorn's flags on the number as printed", () => {
    // `*`, `x` and `s` are how Shorthorn records what kind of entry it is.
    // They stay, because the number as printed is what somebody checks
    // against the paper in the drawer.
    expect(parsePedigreeEntry("*sxAR30383        [ 0016 ]        OCC LUSTRE 0016", "")).toMatchObject(
      { regNumber: "*sxAR30383", name: "OCC LUSTRE 0016" },
    );
  });

  it("reads an empty tattoo as no tattoo", () => {
    expect(parsePedigreeEntry("264745        FGJ HABANERO         [ ]", "")?.tattoo).toBeUndefined();
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
