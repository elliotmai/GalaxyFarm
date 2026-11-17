import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import { cattleCandidateSchema } from "../src/domain/cattle-candidate.js";
import {
  candidateFromListing,
  herdbookFor,
  matchCatalogParent,
  nameTokens,
  parentNamesFromFields,
  registrationFromFields,
  sexOfListing,
  type CatalogEntry,
  type ListingFields,
} from "../src/domain/sale-listing.js";

const CANDIDATE = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as Ulid;
const SIRE_ID = "01BX5ZZKBKACTAV9WEVGEMMVRY" as Ulid;
const DAM_ID = "01CP7ZZKBKACTAV9WEVGEMMVRZ" as Ulid;

/** Lot 001 from the Lyle & Ruebush sale, as the listing prints it. */
const LYLE_LOT: ListingFields = {
  Sire: "Coping Wtih Destiny",
  Dam: "Jazzy (Jass On The Mark X Brilliance)",
  DOB: "January 2026",
  Sex: "Heifer",
  Breed: "Purebred Simmental",
  "ASA Reg Number": "4668198",
  Consignor: "Colt Lyle (540) 487-4819",
};

describe("nameTokens", () => {
  it("drops punctuation, parentheticals, and stop words", () => {
    expect(nameTokens("Jazzy (Jass On The Mark X Brilliance)")).toEqual(["jazzy"]);
    expect(nameTokens("TJSC COPING WITH DESTINY 9K")).toEqual([
      "tjsc",
      "coping",
      "with",
      "destiny",
      "9k",
    ]);
  });
});

describe("herdbookFor", () => {
  it("names the herdbook for a purebred or half-blood of a registered breed", () => {
    expect(herdbookFor("Purebred Simmental")).toBe("Simmental");
    expect(herdbookFor("PB Maine")).toBe("Maine-Anjou");
    expect(herdbookFor("Shorthorn")).toBe("Shorthorn");
  });

  it("names none for a cross, since it could file under either", () => {
    expect(herdbookFor("Maine/Chi/Cross")).toBeUndefined();
    expect(herdbookFor("Maine-Angus")).toBeUndefined();
    expect(herdbookFor(undefined)).toBeUndefined();
  });
});

describe("registrationFromFields", () => {
  it("reads the number and files it under the breed's herdbook, not the printed prefix", () => {
    expect(registrationFromFields(LYLE_LOT, "Purebred Simmental")).toEqual({
      association: "Simmental",
      regNumber: "4668198",
    });
  });

  it("reads the other labels sellers use", () => {
    expect(registrationFromFields({ "Reg #": "1234 56" }, "Shorthorn")).toEqual({
      association: "Shorthorn",
      regNumber: "123456",
    });
    expect(registrationFromFields({ "Registration Number": "99" }, "Angus")).toEqual({
      association: "Angus",
      regNumber: "99",
    });
  });

  it("does not take a ranch tag for a registration", () => {
    expect(registrationFromFields({ "Ranch Tag": "16" }, "Simmental")).toBeUndefined();
  });

  it("returns nothing without a herdbook, rather than filing a number under a guess", () => {
    expect(registrationFromFields(LYLE_LOT, "Maine/Chi/Cross")).toBeUndefined();
  });
});

describe("parentNamesFromFields", () => {
  it("reads the sire and dam, and reports neither when they are not printed", () => {
    expect(parentNamesFromFields(LYLE_LOT)).toEqual({
      sire: "Coping Wtih Destiny",
      dam: "Jazzy (Jass On The Mark X Brilliance)",
    });
    expect(parentNamesFromFields({ Sex: "Steer" })).toEqual({ sire: undefined, dam: undefined });
  });
});

describe("matchCatalogParent", () => {
  const catalog: CatalogEntry[] = [
    { kind: "external", id: SIRE_ID, names: ["TJSC COPING WITH DESTINY 9K"] },
    { kind: "animal", id: DAM_ID, names: ["Jazzy", "JAZZY 12"] },
  ];

  it("takes an exact name match", () => {
    expect(matchCatalogParent("Jazzy (Jass On The Mark X Brilliance)", catalog)).toEqual({
      kind: "animal",
      id: DAM_ID,
    });
  });

  it("takes a fuzzy match when it is the only one, despite the seller's spelling", () => {
    expect(matchCatalogParent("Coping Wtih Destiny", catalog)).toEqual({
      kind: "external",
      id: SIRE_ID,
    });
  });

  it("refuses when two catalog animals could be the parent", () => {
    const twins: CatalogEntry[] = [
      { kind: "external", id: SIRE_ID, names: ["Coping With Destiny"] },
      { kind: "animal", id: DAM_ID, names: ["Coping With Destiny 2"] },
    ];
    expect(matchCatalogParent("Coping Wtih Destiny", twins)).toBeUndefined();
  });

  it("does not match on a single shared word", () => {
    expect(
      matchCatalogParent("Tecumseh", [{ kind: "external", id: SIRE_ID, names: ["Tecumseh Jr"] }]),
    ).toBeUndefined();
  });

  it("matches nothing when the listing names no parent", () => {
    expect(matchCatalogParent(undefined, catalog)).toBeUndefined();
  });
});

describe("sexOfListing", () => {
  it("maps the listing's sex to the candidate's", () => {
    expect(sexOfListing("Open Heifer")).toBe("female");
    expect(sexOfListing("Bred Cow")).toBe("female");
    expect(sexOfListing("Bull")).toBe("male");
    expect(sexOfListing("Steer")).toBe("steer");
    expect(sexOfListing("-")).toBe("unknown");
  });
});

describe("candidateFromListing", () => {
  const base = {
    candidateId: CANDIDATE,
    sale: {
      title: "Lyle & Ruebush Steer, Heifer and Genetics Sale - VA",
      location: "142 Buffalo Branch Lane, Swoope VA",
      endsAt: new Date("2026-10-31T00:00:00Z"),
    },
    lot: {
      lotNumber: "001",
      lotName: "Purebred Simmental Heifer ",
      lotUrl: "https://www.sconlinesales.com/Bids/AuctionsListing/48641#l001",
      nextBid: 2500,
      pictureUrl:
        "https://sco-media.azureedge.net/media-md/2026/10/23/8d3ca2d9c9fc4bc9a7367fc5156ffa29.jpg",
      videoUrl: "https://youtu.be/TvEEwqsYviA?feature=shared",
    },
    fields: LYLE_LOT,
    catalog: [{ kind: "external" as const, id: SIRE_ID, names: ["TJSC COPING WITH DESTINY 9K"] }],
  };

  it("maps the lot onto the candidate the list shows", () => {
    const listed = candidateFromListing(base);
    expect(listed.title).toBe("Lot 001: Purebred Simmental Heifer");
    expect(listed.askingPrice.cents).toBe(250_000);
    expect(listed.location).toBe("142 Buffalo Branch Lane, Swoope VA");
    expect(listed.listingUrl).toBe(base.lot.lotUrl);
    expect(listed.expiresAt).toEqual(new Date("2026-10-31T00:00:00Z"));
  });

  it("carries the registration, sale, picture, video and parents on the detail", () => {
    const { domainDetail } = candidateFromListing(base);
    expect(domainDetail).toMatchObject({
      sex: "female",
      bred: false,
      unpapered: false,
      association: "Simmental",
      regNumber: "4668198",
      saleType: "auction",
      lotNumber: "001",
      saleName: "Lyle & Ruebush Steer, Heifer and Genetics Sale - VA",
      pictureUrl: base.lot.pictureUrl,
      videoUrl: base.lot.videoUrl,
      sireName: "Coping Wtih Destiny",
      damName: "Jazzy (Jass On The Mark X Brilliance)",
      sire: { kind: "external", id: SIRE_ID },
      dam: undefined,
      dobText: "January 2026",
      breedText: "Purebred Simmental",
    });
  });

  it("produces a detail the candidate schema accepts without stripping the new fields", () => {
    const { domainDetail } = candidateFromListing(base);
    const parsed = cattleCandidateSchema.parse(domainDetail);
    expect(parsed.pictureUrl).toBe(base.lot.pictureUrl);
    expect(parsed.saleName).toBe("Lyle & Ruebush Steer, Heifer and Genetics Sale - VA");
    expect(parsed.sireName).toBe("Coping Wtih Destiny");
  });

  it("leaves a lot with no bids and no printed registration honest about both", () => {
    const listed = candidateFromListing({
      ...base,
      lot: { ...base.lot, nextBid: undefined, pictureUrl: undefined, videoUrl: undefined },
      fields: { Sex: "Open Heifer", Breed: "Maine/Chi/Cross" },
    });
    expect(listed.askingPrice.cents).toBe(0);
    expect(listed.domainDetail.regNumber).toBeUndefined();
    expect(listed.domainDetail.association).toBeUndefined();
    expect(listed.domainDetail.unpapered).toBe(false);
  });
});
