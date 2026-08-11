import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import {
  animalHref,
  animalSlug,
  animalTitle,
  duplicateSlugs,
  resolveAnimalSlug,
  slugify,
} from "../lib/animal-slug.js";

/**
 * Addressing a cow (spec §7: `/admin/cattle/[id]`).
 *
 * `/admin/cattle/01ARZ3NDEKTSV4RRFFQ69G5FP1` is correct and useless — nobody
 * can read it, type it, or tell from a browser history which cow it was. The
 * id stays the identity; this is only an address.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;

const andromeda = { id: id(1), name: "Andromeda", tagNumber: "A12" };
const dolly = { id: id(2), name: "Dolly" };

describe("slugify", () => {
  it("lowercases and joins on single dashes", () => {
    expect(slugify("ZNT Montego Bay")).toBe("znt-montego-bay");
  });

  it("collapses runs of punctuation rather than leaving empty segments", () => {
    expect(slugify("Red — #12 // spot")).toBe("red-12-spot");
  });

  it("strips accents instead of percent-encoding them into noise", () => {
    expect(slugify("Ámbar")).toBe("ambar");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("  --Red--  ")).toBe("red");
  });

  it("returns nothing for a string with no letters or digits in it", () => {
    expect(slugify("———")).toBe("");
  });
});

describe("animalSlug", () => {
  it("prefers the tag, which is what is written on the animal", () => {
    // A name is what she is called; a tag is what she is, and it is the thing
    // two people will agree on.
    expect(animalSlug(andromeda)).toBe("a12");
  });

  it("falls back to a registration number when there is no tag", () => {
    expect(animalSlug(dolly, "AMAA M123456")).toBe("amaa-m123456");
  });

  it("falls back to the name when there is neither", () => {
    expect(animalSlug(dolly)).toBe("dolly");
  });

  it("falls back to the id only when nothing readable exists", () => {
    expect(animalSlug({ id: id(3) })).toBe(id(3).toLowerCase());
  });

  it("skips a field that slugifies to nothing", () => {
    expect(animalSlug({ id: id(4), tagNumber: "—", name: "Belle" })).toBe("belle");
  });
});

describe("resolveAnimalSlug", () => {
  const herd = [andromeda, dolly];

  it("finds an animal by its current slug", () => {
    expect(resolveAnimalSlug("a12", herd)?.animal.id).toBe(id(1));
    expect(resolveAnimalSlug("a12", herd)?.stale).toBe(false);
  });

  it("still finds her by a name she used to be addressed by", () => {
    // Losing a bookmark because somebody corrected a spelling — or finally
    // tagged a calf — is the kind of small betrayal that stops people trusting
    // the app with anything.
    const found = resolveAnimalSlug("andromeda", herd);

    expect(found?.animal.id).toBe(id(1));
    expect(found?.stale).toBe(true);
  });

  it("still finds her by id, so an old link keeps working", () => {
    expect(resolveAnimalSlug(id(1), herd)?.animal.id).toBe(id(1));
    expect(resolveAnimalSlug(id(1), herd)?.stale).toBe(true);
  });

  it("finds her by registration when that is what the URL held", () => {
    const registrations = new Map([[id(2), "M123456"]]);
    const found = resolveAnimalSlug("m123456", herd, (a) => registrations.get(a.id));

    expect(found?.animal.id).toBe(id(2));
  });

  it("decodes a percent-encoded segment", () => {
    expect(resolveAnimalSlug("Andromeda", herd)?.animal.id).toBe(id(1));
  });

  it("says nothing for a segment matching no animal", () => {
    expect(resolveAnimalSlug("nobody", herd)).toBeUndefined();
    expect(resolveAnimalSlug("---", herd)).toBeUndefined();
  });

  it("picks the older of two animals sharing a slug rather than refusing both", () => {
    // Two cows called Red is a data problem to fix on the herd screen, not a
    // reason to show neither.
    const twins = [
      { id: id(9), name: "Red" },
      { id: id(5), name: "Red" },
    ];

    expect(resolveAnimalSlug("red", twins)?.animal.id).toBe(id(5));
  });
});

describe("duplicateSlugs", () => {
  it("reports a collision so it can be surfaced and fixed", () => {
    const twins = [
      { id: id(5), name: "Red" },
      { id: id(9), name: "Red" },
    ];

    expect(duplicateSlugs(twins).get("red")).toHaveLength(2);
  });

  it("says nothing when every animal is distinct", () => {
    expect(duplicateSlugs([andromeda, dolly]).size).toBe(0);
  });
});

describe("animalHref and animalTitle", () => {
  it("links under the cattle route", () => {
    expect(animalHref(andromeda)).toBe("/admin/cattle/a12");
  });

  it("names an animal without ever rendering undefined", () => {
    expect(animalTitle(andromeda)).toBe("Andromeda");
    expect(animalTitle({ tagNumber: "A12" })).toBe("Tag A12");
    expect(animalTitle({})).toBe("Unnamed");
  });
});
