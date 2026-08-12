import { describe, expect, it } from "vitest";

import { parseDigitalBeefPage, parsePedigreeEntry } from "../src/domain/parsers/digital-beef.js";
import { MAINE_ANJOU_PAGE } from "./fixtures/maine-anjou-pages.js";

/**
 * What a Maine-Anjou page does that the other two do not (spec §5.2).
 *
 * Its distinguishing feature is a subtraction: **this page prints no breed
 * makeup at all.** Everything the AMAA says about what an animal is made of is
 * the one `Classification` field. Checking a dual-registered animal's
 * Maine-Anjou number alone and calling the result complete is what made a
 * whole herd look like it had no breeding on file.
 */

const read = (registration = "402303") =>
  parseDigitalBeefPage(MAINE_ANJOU_PAGE, { association: "AMAA", registration });

const at = (animal: ReturnType<typeof read>, position: string) =>
  animal.ancestors.find((ancestor) => ancestor.position === position);

describe("the Maine-Anjou detail panel", () => {
  it("states the class on the papers and no makeup", () => {
    const animal = read();

    expect(animal.classification).toBe("PB");
    expect(animal.breedComposition).toEqual([]);
  });

  it("reads the tattoo out of the ear that has one", () => {
    // Left and right ears are separate cells and one of them is blank. An
    // empty cell is the same answer as no cell, and both differ from "we
    // could not find where to look".
    expect(read().tattoo).toBe("ZNT901W");
  });

  it("keeps the disposal and what the registry made of it", () => {
    const animal = read();

    expect(animal.status).toBe("Culled - Culled - age");
    expect(animal.disposedOn).toBe("03/17/2022");
  });
});

describe("a Maine-Anjou pedigree line", () => {
  it("reads number-then-tattoo-then-name", () => {
    expect(
      parsePedigreeEntry("185219        [ 38C JMAF ]        JF WAR CHIEF   -- PHAFP THFP", "sire"),
    ).toMatchObject({ regNumber: "185219", name: "JF WAR CHIEF", tattoo: "38C JMAF" });
  });
});

describe("the Maine-Anjou chart", () => {
  it("reads a complete five-generation chart into all thirty slots", () => {
    const animal = read();

    expect(animal.ancestors).toHaveLength(30);
    expect(animal.unplacedAncestors).toEqual([]);
  });

  it("places by in-order position, which is how the chart is drawn", () => {
    // Digital Beef draws each animal vertically centred between its two
    // parents' subtrees, so the flattened chart is an in-order traversal.
    // These are the check: JAZX MS 720G is the dam's dam's dam, out of JAZX MS
    // DESIGN 012D by DESIGNED BY SHOWTIME, and the names corroborate the
    // arithmetic.
    const animal = read();

    expect(at(animal, "dam")?.name).toBe("ZNT JENNA 707T");
    expect(at(animal, "dam's dam")?.name).toBe("JAZX AUDREY 352N");
  });

  it("counts generations from the animal outwards", () => {
    const animal = read();

    expect(at(animal, "sire")?.generation).toBe(1);
    expect(at(animal, "sire's sire")?.generation).toBe(2);
    expect(at(animal, "sire's sire's dam")?.generation).toBe(3);
    expect(at(animal, "sire's sire's dam's dam")?.generation).toBe(4);
  });
});
