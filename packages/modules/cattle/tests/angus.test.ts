import { describe, expect, it } from "vitest";

import {
  angusNumber,
  angusUrl,
  parseAngusPage,
  parseAngusUrl,
  parseConditionStrip,
} from "../src/domain/parsers/angus.js";
import { ANGUS_PAGE } from "./fixtures/angus-page.js";

/**
 * The Angus reader, against a page that actually exists (spec §5.2).
 *
 * Every assertion here was written after reading angus.org's page for
 * registration 13054003, not before. The Digital Beef parser was first written
 * against invented fixtures, passed all of them, and then read a bull's sex as
 * "Bull Sire: MA364424 CMAC TYSON ET" on the first real page it saw. Fixtures
 * that agree with the parser prove nothing.
 */

const read = () =>
  parseAngusPage(ANGUS_PAGE, { registration: "13054003", url: angusUrl("13054003") });

describe("the animal's own panel", () => {
  it("reads the name off the line above the registration, which has no label", () => {
    expect(read().name).toBe("Northern Improvement 4480 GF");
  });

  it("reads the sex off the unlabelled line under the number", () => {
    expect(read().sex).toBe("Bull");
  });

  it("keeps the birth date and tattoo apart, though they share a line", () => {
    // `Birth Date: 03/14/1998 Tattoo: 4480` — taking everything after the
    // first label would file "03/14/1998 Tattoo: 4480" as the birth date.
    const animal = read();

    expect(animal.dob).toBe("03/14/1998");
    expect(animal.tattoo).toBe("4480");
  });

  it("reads the breeder without swallowing the owners underneath", () => {
    expect(read().breeder).toBe("480228 - Rollin Rock Inc, Belgrade MT");
  });

  it("finds every field it looks for", () => {
    expect(read().missing).toEqual([]);
  });

  it("claims no breed makeup", () => {
    // Everything in the herdbook is Angus, so the page prints none. Inventing
    // "100% AN" here would override a Maine-Anjou page that actually knows the
    // animal's makeup.
    expect(read().breedComposition).toEqual([]);
  });
});

describe("the condition strip", () => {
  it("reads the animal's own results, which Digital Beef never prints", () => {
    const tests = read().geneticTests ?? [];

    expect(tests.map((test) => test.defect).sort()).toEqual([
      "AM",
      "CA",
      "D2",
      "DD",
      "M1",
      "NH",
      "OH",
      "OS",
    ]);
    expect(tests.every((test) => test.status === "free")).toBe(true);
  });

  it("does not drop a code it has no name for", () => {
    // `M1`, `OH` and `D2` are on every Angus page and were on none of the
    // other three. An unlisted code is dropped silently, and a dropped `M1C`
    // is a carrier that never appears on any screen.
    expect(parseConditionStrip("M1C-OHF-D2C").map((test) => [test.defect, test.status])).toEqual([
      ["M1", "carrier"],
      ["OH", "free"],
      ["D2", "carrier"],
    ]);
  });

  it("does not round an unrecognised suffix down to free", () => {
    expect(parseConditionStrip("AMZ")[0]?.status).toBe("suspect");
  });
});

describe("the registration number", () => {
  it("strips the flags the association prints in front of it", () => {
    // `AAA #+13054003`. What `#` and `+` mean is in a legend at the foot of
    // the page; recording the wrong one would put "embryo transplant" on a
    // bull that is not one, so neither is read.
    expect(angusNumber("AAA #+13054003")).toBe("13054003");
    expect(angusNumber("AAA #11300211")).toBe("11300211");
    expect(angusNumber("AAA 9250940")).toBe("9250940");
  });

  it("comes off the address, and goes back onto it", () => {
    const parsed = parseAngusUrl("https://www.angus.org/find-an-animal?aid=13054003");

    expect(parsed.ok && parsed.ref.registration).toBe("13054003");
    expect(parsed.ok && parsed.ref.association).toBe("AAA");
    expect(angusUrl("13054003")).toBe("https://www.angus.org/find-an-animal?aid=13054003");
  });

  it("declines an address from somewhere else rather than guessing", () => {
    const parsed = parseAngusUrl("https://maine-anjou.digitalbeef.com/x?aid=1");

    expect(parsed.ok).toBe(false);
  });
});

describe("the pedigree", () => {
  const at = (position: string) => read().ancestors.find((entry) => entry.position === position);

  it("reads all fourteen and places every one", () => {
    const animal = read();

    expect(animal.ancestors).toHaveLength(14);
    expect(animal.unplacedAncestors).toEqual([]);
  });

  it("puts the parents where the naming says they are", () => {
    // The reading is checked by the herd prefixes and not by arithmetic: a
    // correct in-order read puts `TC Stockman` above `TC Stockman 365` and
    // `Blackcap of R R 0238` above `Blackcap of R R 5367`.
    expect(at("sire")?.name).toBe("TC Stockman 365");
    expect(at("sire")?.regNumber).toBe("11994601");
    expect(at("dam")?.name).toBe("Blackcap of R R 5367");
    expect(at("dam")?.regNumber).toBe("10702296");
  });

  it("runs the herd prefixes down the branches they belong to", () => {
    expect(at("sire's sire")?.name).toBe("TC Stockman");
    expect(at("sire's dam")?.name).toBe("TC Pride 0014");
    expect(at("sire's dam's dam")?.name).toBe("TC Pride 8013");
    expect(at("dam's sire")?.name).toBe("R R Vantage 3352");
    expect(at("dam's dam")?.name).toBe("Blackcap of R R 0238");
    expect(at("dam's dam's dam")?.name).toBe("Blackcap of R R 7020");
  });

  it("shows the line breeding rather than hiding it", () => {
    // Shoshone Vantage JB23 is the sire of both the dam's sire and the dam's
    // dam, so he is printed twice and belongs in both slots.
    expect(at("dam's sire's sire")?.name).toBe("Shoshone Vantage JB23");
    expect(at("dam's dam's sire")?.name).toBe("Shoshone Vantage JB23");
  });

  it("keeps an ancestor's own results off the descendant's chart", () => {
    // `AAA #+10796576[RDF]` — the bracket is that bull's condition strip.
    const prompter = at("sire's sire's sire");

    expect(prompter?.name).toBe("Leachman Prompter");
    expect(prompter?.regNumber).toBe("10796576");
  });

  it("names the parents on the animal itself", () => {
    const animal = read();

    expect(animal.sire).toEqual({ regNumber: "11994601", name: "TC Stockman 365" });
    expect(animal.dam).toEqual({ regNumber: "10702296", name: "Blackcap of R R 5367" });
  });

  it("does not read the EPD table or the navigation as ancestors", () => {
    // The page has no heading over the pedigree, so the run is bounded by
    // shape. `$EN`, `Marb` and `Angus Foundation` are not ancestors.
    const names = read().ancestors.map((entry) => entry.name ?? "");

    expect(names.some((name) => name.includes("$"))).toBe(false);
    expect(names.some((name) => name.includes("Angus"))).toBe(false);
  });
});
