import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseAnimalPage, parseAnimalUrl } from "../src/domain/parsers/index.js";
import { parseSimmentalPage, parseSimmentalUrl } from "../src/domain/parsers/simmental.js";

/**
 * A real American Simmental Association animal page, as a person copied it out
 * of a browser. Checked in as HTML rather than retyped, so every assertion here
 * is against what the ASA actually prints.
 */
const SIMMENTAL_PAGE = readFileSync(
  new URL("./fixtures/simmental-animal.html", import.meta.url),
  "utf8",
);

const ANIMAL_URL =
  "https://herdbook.org/simmapp/action/animalSearch.AnimalSearchAction?eventSubmit_displayAnimal=T&animalNumber=3789539";

describe("the American Simmental Association's animal page", () => {
  const animal = parseSimmentalPage(SIMMENTAL_PAGE, { registration: "3789539" });

  it("reads the animal's identity off the page", () => {
    expect(animal.association).toBe("Simmental");
    expect(animal.registration).toBe("3789539");
    expect(animal.name).toBe("KBHR BOLD RULER H152");
    expect(animal.tattoo).toBe("H152");
    expect(animal.colour).toBe("Black");
    expect(animal.hornStatus).toBe("Polled");
    expect(animal.dob).toBe("2020-03-26");
  });

  it("splits the status line into a status and a sex", () => {
    expect(animal.sex).toBe("Bull");
    expect(animal.status).toBe("Frozen Embryo");
  });

  it("keeps the class the papers state as printed", () => {
    expect(animal.classification).toBe("PB SM");
  });

  it("reads the breeder and the owner, with their account numbers", () => {
    expect(animal.breeder).toBe("066206 - KELLERS BROKEN HEART RANCH");
    expect(animal.owner).toBe("330452 - TRIANGLE J/GENEX");
  });

  it("places the six ancestors on the chart, sire's side above and dam's side below", () => {
    const at = (position: string) => animal.ancestors.find((a) => a.position === position);

    expect(at("sire")).toMatchObject({
      name: "WS PROCLAMATION E202",
      regNumber: "3254156",
      generation: 1,
    });
    expect(at("sire's sire")).toMatchObject({
      name: "CCR COWBOY CUT 5048Z",
      regNumber: "2703910",
      generation: 2,
    });
    expect(at("sire's dam")).toMatchObject({
      name: "WS MISS SUGAR C4",
      regNumber: "2974794",
      generation: 2,
    });
    expect(at("dam")).toMatchObject({
      name: "BAR CK MS X38 106Z",
      regNumber: "2682358",
      generation: 1,
    });
    expect(at("dam's sire")).toMatchObject({
      name: "WS HOT BEEF X38",
      regNumber: "2548377",
      generation: 2,
    });
    expect(at("dam's dam")).toMatchObject({
      name: "BAR CK MS MEAT MKR 323T",
      regNumber: "2378699",
      generation: 2,
    });
    expect(animal.ancestors).toHaveLength(6);
    expect(animal.unplacedAncestors).toHaveLength(0);
  });

  it("takes the parents off the chart into the detail fields", () => {
    expect(animal.sire).toEqual({ regNumber: "3254156", name: "WS PROCLAMATION E202" });
    expect(animal.dam).toEqual({ regNumber: "2682358", name: "BAR CK MS X38 106Z" });
  });

  it("says what it could not read, and does not invent a makeup", () => {
    expect(animal.breedComposition).toEqual([]);
    expect(animal.missing).toEqual(["Breed makeup"]);
  });

  it("is routed to the Simmental reader from the page's own registration", () => {
    const routed = parseAnimalPage(SIMMENTAL_PAGE, {
      association: "Simmental",
      registration: "3789539",
      host: "herdbook.org",
      url: ANIMAL_URL,
    });
    expect(routed.name).toBe("KBHR BOLD RULER H152");
    expect(routed.sourceUrl).toBe(ANIMAL_URL);
  });
});

describe("a pedigree chart of an unexpected shape", () => {
  it("keeps every ancestor unplaced rather than guessing a position", () => {
    const truncated = SIMMENTAL_PAGE.replace(
      /<div class="pedone" style="margin-left:\s+100px">&nbsp;\s*<span class="pedAnmName\s+">WS MISS SUGAR C4<\/span>[\s\S]*?<\/div>/,
      "",
    );
    const animal = parseSimmentalPage(truncated, { registration: "3789539" });

    expect(animal.ancestors).toHaveLength(0);
    expect(animal.unplacedAncestors.length).toBeGreaterThan(0);
    expect(animal.unplacedAncestors.every((a) => a.position === undefined)).toBe(true);
  });
});

describe("the Simmental address", () => {
  it("accepts an address that names the animal", () => {
    expect(parseSimmentalUrl(ANIMAL_URL)).toMatchObject({
      ok: true,
      ref: { association: "Simmental", registration: "3789539", host: "herdbook.org" },
    });
    expect(parseSimmentalUrl("https://herdbook.org/animal/3789539")).toMatchObject({
      ok: true,
      ref: { registration: "3789539" },
    });
  });

  it("refuses the search template, which names no animal", () => {
    const result = parseSimmentalUrl(
      "https://herdbook.org/simmapp/template/animalSearch,IndividualAnimal.vm",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/search page/);
  });

  it("refuses another site", () => {
    expect(parseSimmentalUrl("https://chianina.digitalbeef.com/x?animal_registration=1").ok).toBe(
      false,
    );
  });

  it("is what the import door sends a herdbook address to", () => {
    const parsed = parseAnimalUrl(ANIMAL_URL);
    expect(parsed).toMatchObject({ ok: true, ref: { association: "Simmental" } });
  });
});
