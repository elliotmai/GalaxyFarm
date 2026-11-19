import { describe, expect, it } from "vitest";

import { GARDEN_KINDS } from "../src/domain/kinds.js";

import {
  GARDEN_CROPS,
  GARDEN_KIND_ENTRIES,
  cropFamily,
  gardenCropFor,
  gardenEntryFor,
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

  it("matches the kind somebody means, by any name it goes by", () => {
    expect(searchGardenCrops("zucchini")[0]?.name).toBe("Zucchini");
    expect(searchGardenCrops("jalapeno")[0]).toMatchObject({
      name: "Jalapeño pepper",
      kindOf: "Pepper",
      note: expect.stringMatching(/^Hot/),
    });
    expect(searchGardenCrops("roma")[0]?.name).toBe("Paste tomato");
    expect(searchGardenCrops("scallions")[0]?.name).toBe("Green onion");
  });

  it("puts the crop first and its kinds after it", () => {
    const names = searchGardenCrops("pepper", 20).map((crop) => crop.name);
    expect(names[0]).toBe("Pepper");
    expect(names).toEqual(expect.arrayContaining(["Bell pepper", "Jalapeño pepper"]));
  });

  it("never matches on a scientific name", () => {
    expect(searchGardenCrops("Abelmoschus")).toEqual([]);
  });

  it("reads a kind as its crop for family, rotation and companions", () => {
    expect(gardenCropFor("Jalapeño pepper")?.name).toBe("Pepper");
    expect(gardenCropFor("Butternut squash")?.name).toBe("Squash");
    expect(inferFamily("Habanero")).toBe("Solanaceae");
    expect(inferFamily("Bok choy")).toBe("Brassicaceae");
    expect(gardenEntryFor("Early Jalapeño")?.name).toBe("Jalapeño pepper");
  });

  it("gives every kind a crop the table knows", () => {
    for (const kind of GARDEN_KINDS) {
      expect(
        GARDEN_CROPS.some((crop) => crop.name === kind.crop),
        kind.name,
      ).toBe(true);
    }
    expect(GARDEN_KIND_ENTRIES).toHaveLength(GARDEN_KINDS.length);
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

describe("what people call things", () => {
  it("finds green beans as green beans", () => {
    const names = searchGardenCrops("green beans").map((crop) => crop.name);
    expect(names.slice(0, 2)).toEqual(["Green bean (bush)", "Green bean (pole)"]);
    expect(searchGardenCrops("string beans")[0]?.name).toBe("Green bean (bush)");
    expect(searchGardenCrops("green onions")[0]?.name).toBe("Green onion");
  });
});
