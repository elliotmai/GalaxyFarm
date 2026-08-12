import { describe, expect, it } from "vitest";

import {
  BREEDS,
  breedName,
  breedsFromComposition,
  breedsInUse,
  breedsOf,
  describeBreed,
} from "../src/domain/breeds.js";

/**
 * What breed is this animal (spec §5.2).
 *
 * A list, not a word. This farm's cattle are Maine-Chi-Angus crosses and a
 * field that has to pick one picks wrong every time.
 */

describe("naming a breed", () => {
  it("spells out the codes the associations print", () => {
    expect(breedName("MA")).toBe("Maine-Anjou");
    expect(breedName("CA")).toBe("Chianina");
    expect(breedName("SH")).toBe("Shorthorn");
    expect(breedName("AN")).toBe("Angus");
  });

  it("gives back a code it does not know, rather than guessing", () => {
    // Inventing a breed for a code nobody recognised is putting words in a
    // registry's mouth, on a field that ends up in a sale catalogue.
    expect(breedName("ZQ")).toBe("ZQ");
    expect(breedName("Black Baldy")).toBe("Black Baldy");
  });
});

describe("the list to pick from", () => {
  it("holds each breed once, though several codes decode to it", () => {
    // `BREED_NAMES` is a decoding table: Chianina answers to CA, CH and CHIA.
    // Handing its values straight to a dropdown put Chianina in it three
    // times, which is what a lookup table looks like when it is mistaken for
    // a list.
    expect(BREEDS.filter((name) => name === "Chianina")).toHaveLength(1);
    expect(new Set(BREEDS).size).toBe(BREEDS.length);
  });

  it("does not offer Unrecorded as something to pick", () => {
    // It is what an association writes when it does not know.
    expect(BREEDS).not.toContain("Unrecorded");
  });

  it("still covers the breeds this farm runs", () => {
    expect(BREEDS).toEqual(
      expect.arrayContaining(["Maine-Anjou", "Chianina", "Shorthorn", "Angus"]),
    );
  });
});

describe("working the breeds out of a makeup", () => {
  it("names the ones worth naming, biggest share first", () => {
    // ZNT MONTEGO BAY, off his real Chianina page.
    expect(
      breedsFromComposition([
        { breed: "CA", percent: 3.72 },
        { breed: "MA", percent: 79.57 },
        { breed: "AN", percent: 14.41 },
        { breed: "XX", percent: 2.3 },
      ]),
    ).toEqual(["Maine-Anjou", "Angus"]);
  });

  it("drops the unrecorded remainder rather than calling it a breed", () => {
    expect(breedsFromComposition([{ breed: "XX", percent: 100 }])).toEqual([]);
  });

  it("keeps the largest share when nothing clears the bar", () => {
    // A genuinely fragmented makeup. "No breed" is a worse answer than
    // "mostly this".
    expect(
      breedsFromComposition([
        { breed: "MA", percent: 4 },
        { breed: "AN", percent: 3 },
      ]),
    ).toEqual(["Maine-Anjou"]);
  });

  it("does not list one breed twice because two codes mean it", () => {
    expect(
      breedsFromComposition([
        { breed: "CA", percent: 50 },
        { breed: "CH", percent: 50 },
      ]),
    ).toEqual(["Chianina"]);
  });
});

describe("what to call an animal", () => {
  it("derives from the makeup when nobody has said", () => {
    expect(breedsOf({ breedComposition: [{ breed: "SH", percent: 100 }] })).toEqual(["Shorthorn"]);
  });

  it("lets what somebody typed win", () => {
    // A commercial cow bought as a black baldy has a breed and will never have
    // a makeup. Recomputing that from an eighth of a pedigree would be the app
    // telling the owner what is standing in his own pasture.
    expect(
      breedsOf({
        breed: ["Black Baldy"],
        breedComposition: [{ breed: "AN", percent: 100 }],
      }),
    ).toEqual(["Black Baldy"]);
  });

  it("has nothing to say about an animal with neither", () => {
    expect(breedsOf({})).toEqual([]);
    expect(describeBreed({})).toBe("");
  });

  it("reads as one line on a list", () => {
    expect(
      describeBreed({
        breedComposition: [
          { breed: "MA", percent: 60 },
          { breed: "AN", percent: 40 },
        ],
      }),
    ).toBe("Maine-Anjou · Angus");
  });
});

describe("the breeds a herd actually runs", () => {
  it("puts the common ones first, whatever their initials", () => {
    const herd = [
      { breed: ["Maine-Anjou"] },
      { breed: ["Maine-Anjou", "Angus"] },
      { breed: ["Angus"] },
      { breed: ["Hereford"] },
    ];

    expect(breedsInUse(herd)).toEqual(["Angus", "Maine-Anjou", "Hereford"]);
  });

  it("counts an animal that has none at all as nothing", () => {
    expect(breedsInUse([{}, {}])).toEqual([]);
  });
});
