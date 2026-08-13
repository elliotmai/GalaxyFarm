import { describe, expect, it } from "vitest";

import {
  ancestorMatches,
  canBe,
  filterAncestors,
  inferAncestorSexes,
  NO_FILTER,
  planAncestorMerge,
  sexFromPosition,
} from "../src/domain/ancestors.js";
import type { ExternalAnimal } from "../src/domain/pedigree.js";
import type { Ulid } from "@galaxy-farm/core";

/**
 * Telling the bulls from the cows on the ancestors list (spec §5.2).
 *
 * Nobody types this in. A certificate has a sire column and a dam column
 * rather than a sex field, so sex is derived from how an animal is used — and
 * the reason it matters is that a sire dropdown with four hundred names in it,
 * half of them cows, is how a cow gets recorded as a bull's sire. Every
 * pedigree, relatedness figure and colour prediction drawn afterwards is then
 * wrong in a way that looks perfectly ordinary on screen.
 */

let sequence = 0;
const animal = (over: Partial<ExternalAnimal> & { name: string }): ExternalAnimal =>
  ({
    id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(sequence++).padStart(2, "A")}` as Ulid,
    propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  }) as ExternalAnimal;

describe("which slot an ancestor sits in", () => {
  it("reads the last word of the position", () => {
    expect(sexFromPosition("sire")).toBe("male");
    expect(sexFromPosition("dam's dam's sire")).toBe("male");
    expect(sexFromPosition("sire's sire's dam")).toBe("female");
  });

  it("says nothing about a position it does not recognise", () => {
    expect(sexFromPosition("somewhere on the dam's side")).toBeUndefined();
  });
});

describe("working out the sexes", () => {
  const bull = animal({ name: "CMAC TYSON ET" });
  const cow = animal({ name: "ZNT JENNA 707T" });

  it("takes it from who names the animal as a parent", () => {
    const sexes = inferAncestorSexes(
      [bull, cow],
      [{ sire: { kind: "external", id: bull.id }, dam: { kind: "external", id: cow.id } }],
    );

    expect(sexes.get(bull.id)).toMatchObject({ sex: "male", inferred: true });
    expect(sexes.get(cow.id)).toMatchObject({ sex: "female", inferred: true });
  });

  it("prefers a recorded sex over an inferred one", () => {
    const typed = animal({ name: "SOMEBODY", sex: "female" });
    const sexes = inferAncestorSexes([typed], [{ sire: { kind: "external", id: typed.id } }]);

    expect(sexes.get(typed.id)).toMatchObject({ sex: "female", inferred: false });
  });

  it("leaves an animal nothing points at alone", () => {
    const sexes = inferAncestorSexes([bull], []);

    expect(sexes.get(bull.id)?.sex).toBeUndefined();
  });

  it("flags an animal used as both rather than picking a winner", () => {
    // One record names it a sire and another names it a dam, so one of the two
    // pedigrees hanging off it is wrong. Resolving it here would hide that.
    const sexes = inferAncestorSexes(
      [bull],
      [{ sire: { kind: "external", id: bull.id } }, { dam: { kind: "external", id: bull.id } }],
    );

    expect(sexes.get(bull.id)?.conflict).toBe(true);
    expect(sexes.get(bull.id)?.sex).toBeUndefined();
  });

  it("ignores parents that are our own animals", () => {
    // An on-farm animal has its own sex field and is not an ancestor record.
    const sexes = inferAncestorSexes([bull], [{ sire: { kind: "animal", id: bull.id } }]);

    expect(sexes.get(bull.id)?.sex).toBeUndefined();
  });
});

describe("who can be a sire", () => {
  it("keeps a known cow out of the sire list", () => {
    expect(canBe({ sex: "female", inferred: true, conflict: false }, "male")).toBe(false);
  });

  it("offers an animal nobody has placed in both lists", () => {
    // Hiding the animal somebody is looking for is the worse failure: they
    // will add a duplicate rather than conclude the list is filtered.
    expect(canBe({ inferred: true, conflict: false }, "male")).toBe(true);
    expect(canBe(undefined, "female")).toBe(true);
  });
});

describe("finding one", () => {
  const solution = animal({
    name: "SULL TINA'S SOLUTION ET",
    regNumber: "*x4157771",
    association: "ASA",
    tattoo: "9213",
    colour: "Red",
  });

  it("matches every word, in any order", () => {
    expect(ancestorMatches(solution, "sull tina")).toBe(true);
    expect(ancestorMatches(solution, "tina sull")).toBe(true);
    expect(ancestorMatches(solution, "sull hereford")).toBe(false);
  });

  it("ignores the punctuation nobody types", () => {
    expect(ancestorMatches(solution, "tinas")).toBe(true);
  });

  it("finds an animal by its registration number", () => {
    // Often the only part of a worn certificate anybody can read.
    expect(ancestorMatches(solution, "4157771")).toBe(true);
    expect(ancestorMatches(solution, "asa")).toBe(true);
  });

  it("finds one by tattoo or colour", () => {
    expect(ancestorMatches(solution, "9213")).toBe(true);
    expect(ancestorMatches(solution, "red")).toBe(true);
  });

  it("matches everything on an empty search", () => {
    expect(ancestorMatches(solution, "   ")).toBe(true);
  });
});

describe("the filtered list", () => {
  const bull = animal({ name: "CMAC TYSON ET", regNumber: "364424", association: "AMAA" });
  const cow = animal({ name: "ZNT JENNA 707T", association: "ACA", regNumber: "337003" });
  const nameOnly = animal({ name: "GRANDMA'S RED COW" });

  const herd = [bull, cow, nameOnly];
  const sexes = inferAncestorSexes(herd, [
    { sire: { kind: "external", id: bull.id }, dam: { kind: "external", id: cow.id } },
  ]);
  const usedBy = new Map<string, readonly string[]>([
    [`external:${bull.id}`, ["Star"]],
    [`external:${cow.id}`, ["Star"]],
  ]);

  it("sorts by name", () => {
    expect(filterAncestors(herd, NO_FILTER, sexes, usedBy).map((entry) => entry.name)).toEqual([
      "CMAC TYSON ET",
      "GRANDMA'S RED COW",
      "ZNT JENNA 707T",
    ]);
  });

  it("splits the bulls from the cows", () => {
    expect(
      filterAncestors(herd, { ...NO_FILTER, sex: "male" }, sexes, usedBy).map((e) => e.name),
    ).toEqual(["CMAC TYSON ET"]);
    expect(
      filterAncestors(herd, { ...NO_FILTER, sex: "female" }, sexes, usedBy).map((e) => e.name),
    ).toEqual(["ZNT JENNA 707T"]);
  });

  it("finds the ones nothing has placed yet", () => {
    expect(
      filterAncestors(herd, { ...NO_FILTER, sex: "unknown" }, sexes, usedBy).map((e) => e.name),
    ).toEqual(["GRANDMA'S RED COW"]);
  });

  it("filters by registry, across every number an animal holds", () => {
    const both = animal({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
      registrations: [{ association: "ACA", regNumber: "359968" }],
    });

    expect(
      filterAncestors([both], { ...NO_FILTER, association: "ACA" }, sexes, usedBy),
    ).toHaveLength(1);
    expect(
      filterAncestors([both], { ...NO_FILTER, association: "AMAA" }, sexes, usedBy),
    ).toHaveLength(1);
    expect(
      filterAncestors([both], { ...NO_FILTER, association: "ASA" }, sexes, usedBy),
    ).toHaveLength(0);
  });

  it("finds the ones nothing points at, which are the ones safe to delete", () => {
    expect(
      filterAncestors(herd, { ...NO_FILTER, usage: "unused" }, sexes, usedBy).map((e) => e.name),
    ).toEqual(["GRANDMA'S RED COW"]);
  });

  it("separates the papered from the name-only", () => {
    expect(
      filterAncestors(herd, { ...NO_FILTER, papers: "unregistered" }, sexes, usedBy).map(
        (e) => e.name,
      ),
    ).toEqual(["GRANDMA'S RED COW"]);
  });

  it("narrows to one breed, however that breed was arrived at", () => {
    // The bull's breed is typed on his record; the cow's is worked out from
    // her makeup. The filter cannot tell them apart, and should not — both
    // mean the animal is that breed.
    const typed = animal({ name: "A TYPED BULL", breed: ["Maine-Anjou"] });
    const derived = animal({
      name: "A PAPERED COW",
      breedComposition: [
        { breed: "MA", percent: 75 },
        { breed: "AN", percent: 25 },
      ],
    });
    const neither = animal({ name: "A COMMERCIAL COW" });
    const mixed = [typed, derived, neither];

    expect(
      filterAncestors(mixed, { ...NO_FILTER, breed: "Maine-Anjou" }, new Map(), new Map()).map(
        (entry) => entry.name,
      ),
    ).toEqual(["A PAPERED COW", "A TYPED BULL"]);
  });

  it("finds an animal by a breed nobody typed on it", () => {
    const papered = animal({
      name: "A PAPERED COW",
      breedComposition: [{ breed: "SH", percent: 100 }],
    });

    expect(ancestorMatches(papered, "shorthorn")).toBe(true);
  });

  it("applies every filter at once", () => {
    expect(
      filterAncestors(
        herd,
        {
          search: "tyson",
          sex: "male",
          association: "AMAA",
          breed: "",
          usage: "used",
          papers: "registered",
        },
        sexes,
        usedBy,
      ).map((entry) => entry.name),
    ).toEqual(["CMAC TYSON ET"]);
  });
});

describe("animals registered in more than one place", () => {
  const both = animal({
    name: "ZNT MONTEGO BAY 901W",
    regNumber: "402303",
    association: "AMAA",
    registrations: [{ association: "ACA", regNumber: "359968" }],
  });
  const one = animal({ name: "CMAC HARD CORE", regNumber: "323178", association: "AMAA" });

  it("finds the ones held in two registries", () => {
    expect(
      filterAncestors([both, one], { ...NO_FILTER, papers: "multiple" }, new Map(), new Map()).map(
        (entry) => entry.name,
      ),
    ).toEqual(["ZNT MONTEGO BAY 901W"]);
  });

  it("finds a dual-registered animal under either registry", () => {
    // The bug this covers: filtering on a single `regNumber`/`association`
    // pair hid every dual-registered animal from whichever of the two
    // happened not to be the primary one.
    for (const association of ["AMAA", "ACA"]) {
      expect(
        filterAncestors([both], { ...NO_FILTER, association }, new Map(), new Map()),
      ).toHaveLength(1);
    }
  });

  it("finds one by the number the other registry does not use", () => {
    expect(ancestorMatches(both, "359968")).toBe(true);
    expect(ancestorMatches(both, "402303")).toBe(true);
  });
});

describe("folding two records for one animal into one", () => {
  const keep = animal({
    name: "ZNT JENNA 707T",
    regNumber: "378987",
    association: "AMAA",
    colour: "Black",
  });
  const drop = animal({
    name: "ZNT JENNA 707T",
    regNumber: "337003",
    association: "ACA",
    tattoo: "707T",
    colour: "Black",
  });

  it("keeps both registration numbers", () => {
    // The whole point: one cow, two registries, and until now two records
    // each holding half her descendants.
    expect(planAncestorMerge(keep, drop, [], []).patch.registrations).toEqual([
      { association: "AMAA", regNumber: "378987" },
      { association: "ACA", regNumber: "337003" },
    ]);
  });

  it("fills in what the kept record does not have", () => {
    expect(planAncestorMerge(keep, drop, [], []).patch.tattoo).toBe("707T");
  });

  it("never overwrites a value the kept record already has", () => {
    // A merge cannot be undone, and quietly preferring one of two hand-typed
    // values is the kind of thing nobody would notice going wrong.
    const different = animal({ name: "ZNT JENNA 707T", colour: "Red" });
    const plan = planAncestorMerge(keep, different, [], []);

    expect(plan.patch.colour).toBeUndefined();
    expect(plan.warnings.some((warning) => warning.includes("colour"))).toBe(true);
  });

  it("says so when the two are named differently", () => {
    const other = animal({ name: "JENNA" });

    expect(planAncestorMerge(keep, other, [], []).warnings.join(" ")).toMatch(/named differently/);
  });

  it("merges defect results rather than replacing them", () => {
    // A hair card typed against one copy has to survive.
    const tested = animal({
      name: "ZNT JENNA 707T",
      geneticTests: [{ defect: "TH", status: "free" }],
    });
    const alsoTested = animal({
      name: "ZNT JENNA 707T",
      geneticTests: [{ defect: "PHA", status: "carrier" }],
    });

    expect(planAncestorMerge(tested, alsoTested, [], []).patch.geneticTests).toEqual([
      { defect: "TH", status: "free" },
      { defect: "PHA", status: "carrier" },
    ]);
  });

  it("finds everything that has to be repointed", () => {
    const calf = animal({ name: "HER CALF", dam: { kind: "external", id: drop.id } });
    const plan = planAncestorMerge(
      keep,
      drop,
      [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FZZ" as Ulid,
          label: "Star",
          dam: { kind: "external", id: drop.id },
        },
      ],
      [calf],
    );

    expect(plan.repoint).toEqual([
      { kind: "profile", id: "01ARZ3NDEKTSV4RRFFQ69G5FZZ", label: "Star", role: "dam" },
      { kind: "external", id: calf.id, label: "HER CALF", role: "dam" },
    ]);
  });

  it("does not list the record being dropped as pointing at itself", () => {
    const selfRef = { ...drop, dam: { kind: "external" as const, id: drop.id } };

    expect(planAncestorMerge(keep, selfRef, [], [selfRef]).repoint).toEqual([]);
  });
});
