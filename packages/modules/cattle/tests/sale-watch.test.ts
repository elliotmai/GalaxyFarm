import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import {
  listedSex,
  listingNamesBreed,
  matchesSaleWatch,
  saleWatchSchema,
  sexSatisfies,
  type SaleWatch,
} from "../src/domain/sale-watch.js";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as Ulid;

function watch(overrides: Partial<SaleWatch> = {}): SaleWatch {
  return { watchId: ID, name: "Test", sexes: [], breeds: [], enabled: true, ...overrides };
}

describe("listedSex", () => {
  it("reads the sex line the way listings write it", () => {
    expect(listedSex("Open Heifer")).toBe("open_heifer");
    expect(listedSex("Bred Heifer")).toBe("bred_heifer");
    expect(listedSex("Heifer")).toBe("heifer_unspecified");
    expect(listedSex("Bred Cow")).toBe("bred_cow");
    expect(listedSex("Cow")).toBe("cow_unspecified");
    expect(listedSex("Steer")).toBe("steer");
    expect(listedSex("Bull")).toBe("bull");
  });

  it("does not guess when the line is missing or blank", () => {
    expect(listedSex(undefined)).toBe("unknown");
    expect(listedSex("-")).toBe("unknown");
    expect(listedSex("")).toBe("unknown");
  });
});

describe("sexSatisfies", () => {
  it("treats heifer and cow as umbrellas over the bred and open forms", () => {
    expect(sexSatisfies("heifer", "open_heifer")).toBe(true);
    expect(sexSatisfies("heifer", "bred_heifer")).toBe(true);
    expect(sexSatisfies("heifer", "heifer_unspecified")).toBe(true);
    expect(sexSatisfies("heifer", "bred_cow")).toBe(false);
    expect(sexSatisfies("cow", "bred_cow")).toBe(true);
    expect(sexSatisfies("cow", "cow_unspecified")).toBe(true);
    expect(sexSatisfies("cow", "open_heifer")).toBe(false);
  });

  it("is exact for the specific forms", () => {
    expect(sexSatisfies("open_heifer", "heifer_unspecified")).toBe(false);
    expect(sexSatisfies("open_heifer", "bred_heifer")).toBe(false);
    expect(sexSatisfies("bred_cow", "cow_unspecified")).toBe(false);
    expect(sexSatisfies("steer", "steer")).toBe(true);
  });
});

describe("listingNamesBreed", () => {
  it("finds Simmental in purebred, half-blood and mixed listings", () => {
    expect(listingNamesBreed("Simmental", "Simmental")).toBe(true);
    expect(listingNamesBreed("Simmental", "1/2 Simmental")).toBe(true);
    expect(listingNamesBreed("Simmental", "PB SIMMENTAL")).toBe(true);
    expect(listingNamesBreed("Simmental", "Chi, Percentage Simmental")).toBe(true);
    expect(listingNamesBreed("Simmental", "Maine/Chi/Cross")).toBe(false);
  });

  it("finds Chianina from the Chi abbreviation without matching longer words", () => {
    expect(listingNamesBreed("Chianina", "Chi/Cross")).toBe(true);
    expect(listingNamesBreed("Chianina", "Maine/Chi/Cross")).toBe(true);
    expect(listingNamesBreed("Chianina", "Chi & Maintainer")).toBe(true);
    expect(listingNamesBreed("Chianina", "CHI 9.99%")).toBe(true);
    expect(listingNamesBreed("Chianina", "Chicago Cross")).toBe(false);
  });

  it("finds Maine-Anjou in its spellings and its crosses", () => {
    expect(listingNamesBreed("Maine-Anjou", "Maine-Angus")).toBe(true);
    expect(listingNamesBreed("Maine-Anjou", "Maintainer")).toBe(true);
    expect(listingNamesBreed("Maine-Anjou", "Chi, Mainetainer")).toBe(true);
    expect(listingNamesBreed("Maine-Anjou", "Maine Angus")).toBe(true);
    expect(listingNamesBreed("Maine-Anjou", "PB Maine")).toBe(true);
    expect(listingNamesBreed("Maine-Anjou", "Angus")).toBe(false);
  });

  it("finds Shorthorn and Angus by name", () => {
    expect(listingNamesBreed("Shorthorn", "Shorthorn")).toBe(true);
    expect(listingNamesBreed("Angus", "Angus")).toBe(true);
    expect(listingNamesBreed("Angus", "Simmental")).toBe(false);
  });

  it("matches any other breed by its own name as a whole word", () => {
    expect(listingNamesBreed("Hereford", "Polled Hereford")).toBe(true);
    expect(listingNamesBreed("Hereford", "Herefords")).toBe(false);
  });

  it("cannot match a listing with no breed line", () => {
    expect(listingNamesBreed("Simmental", undefined)).toBe(false);
  });
});

describe("matchesSaleWatch", () => {
  it("takes everything when a watch names no sex and no breed", () => {
    expect(matchesSaleWatch(watch(), { sex: "Steer", breed: "Angus" })).toBe(true);
    expect(matchesSaleWatch(watch(), {})).toBe(true);
  });

  it("requires both the sex and the breed a watch names", () => {
    const heiferSimmental = watch({ sexes: ["heifer"], breeds: ["Simmental"] });
    expect(matchesSaleWatch(heiferSimmental, { sex: "Open Heifer", breed: "1/2 Simmental" })).toBe(
      true,
    );
    expect(matchesSaleWatch(heiferSimmental, { sex: "Steer", breed: "Simmental" })).toBe(false);
    expect(matchesSaleWatch(heiferSimmental, { sex: "Heifer", breed: "Angus" })).toBe(false);
  });

  it("matches a listing that names any one of several breeds", () => {
    const either = watch({ breeds: ["Simmental", "Chianina"] });
    expect(matchesSaleWatch(either, { breed: "Chi/Cross" })).toBe(true);
    expect(matchesSaleWatch(either, { breed: "Shorthorn" })).toBe(false);
  });

  it("does not match a breed-specific watch against a listing with no breed line", () => {
    expect(matchesSaleWatch(watch({ breeds: ["Angus"] }), { sex: "Heifer" })).toBe(false);
  });

  it("matches nothing while the watch is paused", () => {
    expect(matchesSaleWatch(watch({ enabled: false }), { sex: "Heifer", breed: "Angus" })).toBe(
      false,
    );
  });
});

describe("saleWatchSchema", () => {
  it("trims the name and rejects a blank one", () => {
    expect(saleWatchSchema.parse({ watchId: ID, name: "  Bred cows  " }).name).toBe("Bred cows");
    expect(() => saleWatchSchema.parse({ watchId: ID, name: "   " })).toThrow();
  });

  it("rejects a sex it does not know", () => {
    expect(() => saleWatchSchema.parse({ watchId: ID, name: "x", sexes: ["mare"] })).toThrow();
  });

  it("defaults to any sex, any breed, and enabled", () => {
    const parsed = saleWatchSchema.parse({ watchId: ID, name: "Anything" });
    expect(parsed).toMatchObject({ sexes: [], breeds: [], enabled: true });
  });
});
