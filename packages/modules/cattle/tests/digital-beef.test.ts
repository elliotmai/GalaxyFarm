import { describe, expect, it } from "vitest";

import {
  digitalBeefUrl,
  parseComposition,
  parseDigitalBeefPage,
  parseDigitalBeefUrl,
  parsePedigreeBlock,
} from "../src/domain/digital-beef.js";

/**
 * Reading a Digital Beef page (§5.2, §12 decision 1 as overridden).
 *
 * There is no API, so this parses a page built for a person to look at, and it
 * will break the day the template changes. These tests are therefore about the
 * two things that must hold when it does break:
 *
 * - it reports what it could not find rather than returning blanks, and
 * - a page it cannot read at all produces "nothing found", not a plausible
 *   animal made of page furniture.
 *
 * The fixtures are hand-built from the shape these pages take. They are not a
 * substitute for running it against a real page once, and the import screen
 * shows every field for approval before anything is saved for that reason.
 */

const PAGE = `
<html><body>
<table>
  <tr><td>Reg #:</td><td>402303</td></tr>
  <tr><td>Animal Name:</td><td>GLXY ANDROMEDA 601P</td></tr>
  <tr><td>Tattoo:</td><td>GLX601P</td></tr>
  <tr><td>Sex:</td><td>Female</td></tr>
  <tr><td>Birth Date:</td><td>02/14/2026</td></tr>
  <tr><td>Color:</td><td>Blue Roan</td></tr>
  <tr><td>Horn Status:</td><td>Polled</td></tr>
  <tr><td>Breed Composition:</td><td>50% MA 25% CH 25% SH</td></tr>
</table>
<h2>Pedigree</h2>
<table>
  <tr><td>WHR SIRE OF NOTE 355012</td></tr>
  <tr><td>OLD GRANDSIRE 201441</td></tr>
  <tr><td>DEEP SIRE LINE 118820</td></tr>
  <tr><td>DEEP DAM LINE 118821</td></tr>
  <tr><td>GRANDDAM ON TOP 201442</td></tr>
  <tr><td>HER SIRE 118822</td></tr>
  <tr><td>HER DAM 118823</td></tr>
  <tr><td>BOTTOM SIDE DAM 355013</td></tr>
</table>
<h2>EPDs</h2>
<table><tr><td>CED</td><td>10.2</td></tr></table>
</body></html>
`;

describe("reading a pasted address", () => {
  it("takes the association from the hostname", () => {
    const result = parseDigitalBeefUrl(
      "https://maine-anjou.digitalbeef.com/modules.php?op=modload&name=_animal&file=_animal&animal_registration=402303",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.association).toBe("AMAA");
    expect(result.ref.registration).toBe("402303");
  });

  it("knows the other two sites", () => {
    const chi = parseDigitalBeefUrl(
      "https://chianina.digitalbeef.com/modules.php?animal_registration=359968",
    );
    const shorthorn = parseDigitalBeefUrl(
      "https://shorthorn.digitalbeef.com/modules.php?animal_registration=4219133",
    );

    expect(chi.ok && chi.ref.association).toBe("ACA");
    expect(shorthorn.ok && shorthorn.ref.association).toBe("ASA");
  });

  it("refuses a site it does not know rather than guessing the registry", () => {
    // A registration number means nothing without the registry that issued it,
    // and filing one under the wrong association is worse than not importing.
    const result = parseDigitalBeefUrl(
      "https://angus.digitalbeef.com/modules.php?animal_registration=1",
    );

    expect(result.ok).toBe(false);
  });

  it("says what is wrong with an address that has no animal on it", () => {
    const result = parseDigitalBeefUrl("https://shorthorn.digitalbeef.com/modules.php?op=modload");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/registration number/i);
  });

  it("rejects something that is not an address at all", () => {
    expect(parseDigitalBeefUrl("402303").ok).toBe(false);
  });

  it("builds the address back from an association and a number", () => {
    expect(digitalBeefUrl("ASA", "4219133")).toContain("shorthorn.digitalbeef.com");
    expect(digitalBeefUrl("ASA", "4219133")).toContain("animal_registration=4219133");
  });
});

describe("breed composition", () => {
  it("reads percentages", () => {
    expect(parseComposition("50% MA 25% CH 25% SH")).toEqual([
      { breed: "MA", percent: 50 },
      { breed: "CH", percent: 25 },
      { breed: "SH", percent: 25 },
    ]);
  });

  it("reads fractions, which the same site also prints", () => {
    expect(parseComposition("1/2 MA 1/4 CH 1/4 SH")).toEqual([
      { breed: "MA", percent: 50 },
      { breed: "CH", percent: 25 },
      { breed: "SH", percent: 25 },
    ]);
  });

  it("returns what it found rather than correcting a total that misses 100", () => {
    // Correcting would be a guess about which share was misread, and the
    // preview screen is where a person notices it does not add up.
    expect(parseComposition("50% MA 25% CH")).toHaveLength(2);
  });

  it("finds nothing in text that holds no composition", () => {
    expect(parseComposition("Polled")).toEqual([]);
  });
});

describe("the pedigree block", () => {
  it("assigns ancestors to positions in chart order", () => {
    const ancestors = parsePedigreeBlock("Pedigree\nWHR SIRE 355012\nGRANDSIRE 201441\n");

    expect(ancestors[0]).toMatchObject({ position: "sire", generation: 1, regNumber: "355012" });
    expect(ancestors[1]).toMatchObject({ position: "sire's sire", generation: 2 });
  });

  it("splits a line into the name and the registration number", () => {
    const [first] = parsePedigreeBlock("Pedigree\nWHR SIRE OF NOTE 355012\n");

    expect(first?.name).toBe("WHR SIRE OF NOTE");
    expect(first?.regNumber).toBe("355012");
  });

  it("stops at whatever section follows the chart", () => {
    // Without this, every EPD row on the page becomes an ancestor.
    const ancestors = parsePedigreeBlock("Pedigree\nREAL SIRE 355012\nEPDs\nCED 10.2\nBW 2.1\n");

    expect(ancestors).toHaveLength(1);
  });

  it("never claims more ancestors than a three-generation chart holds", () => {
    const many = ["Pedigree", ...Array.from({ length: 40 }, (_, i) => `ANIMAL ${i} ${100000 + i}`)];

    expect(parsePedigreeBlock(many.join("\n")).length).toBeLessThanOrEqual(14);
  });
});

describe("a whole page", () => {
  const animal = parseDigitalBeefPage(PAGE, { association: "AMAA", registration: "402303" });

  it("reads the fields by their labels", () => {
    expect(animal.name).toBe("GLXY ANDROMEDA 601P");
    expect(animal.tattoo).toBe("GLX601P");
    expect(animal.sex).toBe("Female");
    expect(animal.dob).toBe("02/14/2026");
    expect(animal.colour).toBe("Blue Roan");
    expect(animal.hornStatus).toBe("Polled");
  });

  it("reads the composition", () => {
    expect(animal.breedComposition).toEqual([
      { breed: "MA", percent: 50 },
      { breed: "CH", percent: 25 },
      { breed: "SH", percent: 25 },
    ]);
  });

  it("reads the pedigree and names each position", () => {
    expect(animal.ancestors[0]).toMatchObject({ position: "sire", regNumber: "355012" });
    expect(animal.ancestors.map((entry) => entry.position)).toContain("dam");
  });

  it("keeps the association and number it was asked for", () => {
    expect(animal.association).toBe("AMAA");
    expect(animal.registration).toBe("402303");
  });

  it("reports a field it could not find rather than leaving a blank", () => {
    // The difference between "this animal has no tattoo" and "the template
    // changed and we cannot read tattoos any more".
    const thin = parseDigitalBeefPage("<html><body>Nothing here</body></html>", {
      association: "ACA",
      registration: "1",
    });

    expect(thin.missing).toContain("Tattoo");
    expect(thin.missing).toContain("Pedigree");
    expect(thin.name).toBeUndefined();
  });

  it("makes no animal at all out of a page it cannot read", () => {
    const empty = parseDigitalBeefPage("<html><body><p>Login required</p></body></html>", {
      association: "ASA",
      registration: "1",
    });

    expect(empty.ancestors).toEqual([]);
    expect(empty.breedComposition).toEqual([]);
  });
});
