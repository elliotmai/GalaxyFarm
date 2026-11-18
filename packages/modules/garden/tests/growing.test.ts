import { describe, expect, it } from "vitest";

import { GARDEN_CROPS } from "../src/domain/families.js";
import {
  cropGrowing,
  GROWING,
  growingFor,
  growingLine,
  isEmptyGrowing,
} from "../src/domain/growing.js";

/** How a crop is grown (§5.5): the built-in half of what a plant pick fills in. */

describe("the growing table", () => {
  it("has a row for every crop the family table knows, and nothing else", () => {
    expect([...GROWING.keys()].sort()).toEqual(GARDEN_CROPS.map((crop) => crop.name).sort());
  });

  it("finds a crop through its aliases and inside a variety's name", () => {
    expect(growingFor("aubergine")).toMatchObject({ season: "warm", sowing: "transplant" });
    expect(growingFor("Cherokee Purple tomato")).toMatchObject({
      daysToMaturity: 75,
      spacingInches: 24,
    });
    expect(growingFor("Moonflower")).toBeUndefined();
  });

  it("leaves the season off perennials, which are not planted by season", () => {
    expect(growingFor("Asparagus")).toMatchObject({ lifecycle: "perennial" });
    expect(growingFor("Asparagus")?.season).toBeUndefined();
    for (const [name, facts] of GROWING) {
      if (facts.lifecycle === "perennial") expect(facts.season, name).toBeUndefined();
      else expect(facts.season, name).toBeDefined();
    }
  });

  it("says the facts that tell crops apart in one line", () => {
    expect(growingLine(growingFor("tomato"))).toBe('Warm season · 75 days · 24" apart · full sun');
    expect(growingLine(growingFor("rhubarb"))).toBe('Perennial · 36" apart · full sun');
    expect(growingLine({})).toBeUndefined();
  });

  it("reads a crop's own facts first, and fills the rest from the table", () => {
    expect(cropGrowing({ name: "Tomato" })).toMatchObject({ daysToMaturity: 75 });
    // Its own 90 days win; the table still says when to start it inside.
    expect(cropGrowing({ name: "Tomato", daysToMaturity: 90 })).toMatchObject({
      daysToMaturity: 90,
      spacingInches: 24,
      startIndoorsWeeks: 7,
      frostTolerance: "tender",
    });
    expect(cropGrowing({ name: "Moonflower", daysToMaturity: 60 })).toEqual({ daysToMaturity: 60 });
    expect(cropGrowing({ name: "Moonflower" })).toBeUndefined();
  });

  it("knows when every crop it lists goes in", () => {
    expect(GROWING.get("Pepper")).toMatchObject({ startIndoorsWeeks: 9, plantOutWeeks: 2 });
    expect(GROWING.get("Pea")).toMatchObject({ frostTolerance: "hardy", plantOutWeeks: -6 });
    expect(GROWING.get("Garlic")).toMatchObject({ fallPlantWeeks: 4 });
    for (const [name, facts] of GROWING) {
      expect(facts.frostTolerance, name).toBeDefined();
    }
  });

  it("knows an empty answer from a partial one", () => {
    expect(isEmptyGrowing(undefined)).toBe(true);
    expect(isEmptyGrowing({})).toBe(true);
    expect(isEmptyGrowing({ sun: "full" })).toBe(false);
  });
});
