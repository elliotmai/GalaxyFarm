import { describe, expect, it } from "vitest";

import {
  GARDEN_CROPS,
  cropFamily,
  gardenCropFor,
  inferFamily,
  normaliseFamily,
  searchGardenCrops,
} from "../src/domain/families.js";

/**
 * The family is inferred, so the rotation guard needs no typing (§5.5).
 *
 * What these pin is the behaviour a gardener would notice: a tomato is a
 * nightshade without anybody saying so, a family somebody did type wins, and
 * an old spelling of a family does not split one rotation into two.
 */

describe("inferFamily", () => {
  it.each([
    ["Tomato", "Solanaceae"],
    ["tomatoes", "Solanaceae"],
    ["Pepper", "Solanaceae"],
    ["potato", "Solanaceae"],
    ["Eggplant", "Solanaceae"],
    ["Kale", "Brassicaceae"],
    ["broccoli", "Brassicaceae"],
    ["Cabbage", "Brassicaceae"],
    ["Zucchini", "Cucurbitaceae"],
    ["Bush bean", "Fabaceae"],
    ["Garlic", "Amaryllidaceae"],
    ["Carrot", "Apiaceae"],
    ["Lettuce", "Asteraceae"],
    ["Swiss chard", "Amaranthaceae"],
    ["Sweet corn", "Poaceae"],
    ["Okra", "Malvaceae"],
  ])("knows %s is %s", (name, family) => {
    expect(inferFamily(name)).toBe(family);
  });

  it("finds the crop inside a longer name, on whole words", () => {
    expect(inferFamily("Cherokee Purple tomato")).toBe("Solanaceae");
    expect(gardenCropFor("Black-eyed peas")?.name).toBe("Southern pea");
    // A peanut is not a pea, and the whole-word rule is what says so.
    expect(inferFamily("Peanut")).toBe("Fabaceae");
    expect(gardenCropFor("Peanut")?.name).toBe("Peanut");
  });

  it("falls back to the genus of a scientific name", () => {
    expect(inferFamily("Roma", "Solanum lycopersicum")).toBe("Solanaceae");
    expect(inferFamily("Something odd", "Brassica carinata")).toBe("Brassicaceae");
  });

  it("says nothing about a plant it has never heard of", () => {
    expect(inferFamily("Moonflower")).toBeUndefined();
    expect(inferFamily("")).toBeUndefined();
    expect(inferFamily(undefined)).toBeUndefined();
  });
});

describe("cropFamily", () => {
  it("prefers the family on the record — typed, or from a search pick", () => {
    expect(cropFamily({ name: "Tomato", family: "Rosaceae" })).toBe("Rosaceae");
  });

  it("infers when the record carries none", () => {
    expect(cropFamily({ name: "Tomato" })).toBe("Solanaceae");
    expect(cropFamily({ name: "Tomato", family: "  " })).toBe("Solanaceae");
    expect(cropFamily(undefined)).toBeUndefined();
  });

  it("folds old family names so one rotation is not read as two", () => {
    expect(cropFamily({ name: "Onion", family: "Alliaceae" })).toBe(cropFamily({ name: "Onion" }));
    expect(normaliseFamily("leguminosae")).toBe("Fabaceae");
    expect(normaliseFamily("solanaceae ")).toBe("Solanaceae");
  });
});

describe("searchGardenCrops", () => {
  it("puts the crop itself first", () => {
    expect(searchGardenCrops("tom")[0]?.name).toBe("Tomato");
    expect(searchGardenCrops("tomato")[0]?.scientificName).toBe("Solanum lycopersicum");
  });

  it("matches a word of a cultivar name", () => {
    expect(searchGardenCrops("Brandywine tomato")[0]?.name).toBe("Tomato");
  });

  it("matches aliases and scientific names", () => {
    expect(searchGardenCrops("zucchini")[0]?.name).toBe("Squash");
    expect(searchGardenCrops("Abelmoschus")[0]?.name).toBe("Okra");
  });

  it("answers nothing to nothing", () => {
    expect(searchGardenCrops("  ")).toEqual([]);
  });

  it("uses the current family names throughout", () => {
    const families = new Set(GARDEN_CROPS.map((crop) => crop.family));
    expect(families.has("Alliaceae")).toBe(false);
    expect(families.has("Chenopodiaceae")).toBe(false);
    for (const family of families) expect(normaliseFamily(family)).toBe(family);
  });
});
