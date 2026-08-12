import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";
import {
  describeLocus,
  EXTENSION_ALLELES,
  ROAN_ALLELES,
  type CattleProfile,
  type ExternalAnimal,
} from "@galaxy-farm/module-cattle";

import { coatResolver, type Herd } from "@/lib/coat";

/**
 * Working every coat out from the herd as it stands (spec §5.2).
 *
 * The genetics are checked in the module. What is checked here is the thing
 * the owner actually asked for: that the answer is *worked out fresh* from
 * whatever is on file, so recording something new about a parent changes every
 * descendant — rather than being written down once and going quietly stale.
 */

let sequence = 0;
const id = () => `01ARZ3NDEKTSV4RRFFQ69G5F${String(sequence++).padStart(2, "A")}`;
const propertyId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const outsider = (over: Partial<ExternalAnimal> & { name: string }): ExternalAnimal =>
  ({
    id: id(),
    propertyId,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  }) as ExternalAnimal;

const profile = (over: Partial<CattleProfile>): CattleProfile =>
  ({
    id: id(),
    animalId: id(),
    propertyId,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    breedComposition: [],
    geneticTests: [],
    registrations: [],
    ...over,
  }) as CattleProfile;

const extensionOf = (herd: Herd, ref: Parameters<ReturnType<typeof coatResolver>["of"]>[0]) => {
  const found = coatResolver(herd).of(ref);
  return found === undefined ? undefined : describeLocus(found.extension, EXTENSION_ALLELES);
};

describe("crossing both stores", () => {
  it("settles a calf of ours from an ancestor off a certificate", () => {
    // The ordinary case here: the papered parents are outside animals, the
    // calf is one of ours, and nothing in either store has been hair-tested.
    const redDam = outsider({ name: "A RED COW", colour: "Red" });
    const blackSire = outsider({ name: "A BLACK BULL", colour: "Black" });
    const calf = profile({
      colour: "Black",
      sire: { kind: "external", id: blackSire.id },
      dam: { kind: "external", id: redDam.id },
    });

    const herd: Herd = { profiles: [calf], outsiders: [redDam, blackSire] };

    // She had only `e` to give him.
    expect(extensionOf(herd, { kind: "animal", id: calf.animalId })).toContain("/e");
    expect(coatResolver(herd).of({ kind: "animal", id: calf.animalId })?.carriesRed.verdict).toBe(
      "yes",
    );
  });

  it("changes its answer when something new is recorded about a parent", () => {
    // The requirement, stated as a test. The same calf, the same records, one
    // fact added — and the answer has to move. A genotype written down at
    // import time would still read "black, unknown" here.
    const sire = outsider({ name: "A BLACK BULL", colour: "Black" });
    const dam = outsider({ name: "A BLACK COW", colour: "Black" });
    const calf = profile({
      colour: "Black",
      sire: { kind: "external", id: sire.id },
      dam: { kind: "external", id: dam.id },
    });

    const before: Herd = { profiles: [calf], outsiders: [sire, dam] };
    expect(
      coatResolver(before).of({ kind: "animal", id: calf.animalId })?.carriesRed.verdict,
    ).toBe("maybe");

    // A red full sibling turns up. Both parents must carry red, so the calf's
    // own odds move — without anybody touching the calf's record.
    const sibling = profile({
      colour: "Red",
      sire: { kind: "external", id: sire.id },
      dam: { kind: "external", id: dam.id },
    });
    const after: Herd = { profiles: [calf, sibling], outsiders: [sire, dam] };

    const now = coatResolver(after).of({ kind: "animal", id: calf.animalId });
    expect(now?.carriesRed.verdict).toBe("maybe");
    expect(now?.carriesRed.chance).toBeCloseTo(2 / 3, 5);
  });

  it("proves a bull carries red off a calf, not off his own record", () => {
    const bull = outsider({ name: "A BLACK BULL", colour: "Black" });
    const calf = profile({ colour: "Red", sire: { kind: "external", id: bull.id } });

    const herd: Herd = { profiles: [calf], outsiders: [bull] };

    expect(coatResolver(herd).of({ kind: "external", id: bull.id })?.carriesRed.verdict).toBe(
      "yes",
    );
  });

  it("answers for one of ours with no profile row, rather than vanishing", () => {
    // A cattle profile is only written once somebody edits an animal's
    // breeding or genetics, so plenty of the herd has none. Returning nothing
    // for her took the whole colour prediction off the breeding form with no
    // explanation — "nothing is known about her" is a different answer from
    // "no such animal", and it is the one that lets a screen say why.
    const known = coatResolver({ profiles: [], outsiders: [] }).of({
      kind: "animal",
      id: id() as Ulid,
    });

    expect(known).toBeDefined();
    expect(known?.extension.settled).toBe(false);
    expect(known?.roan.settled).toBe(false);
  });

  it("still says nothing about an ancestor it has never heard of", () => {
    // An external id that is not on file really is unknown.
    const stranger = coatResolver({ profiles: [], outsiders: [] }).of({
      kind: "external",
      id: id() as Ulid,
    });

    expect(stranger).toBeUndefined();
  });
});

describe("a pedigree that loops", () => {
  it("stops rather than walking forever", () => {
    // A mistyped registration can make an animal its own grandsire. That is a
    // record to go and fix, not a reason for the page to hang.
    const a = outsider({ name: "A", colour: "Black" });
    const b = outsider({ name: "B", colour: "Black" });
    const looped = [
      { ...a, sire: { kind: "external" as const, id: b.id } },
      { ...b, sire: { kind: "external" as const, id: a.id } },
    ];

    const found = coatResolver({ profiles: [], outsiders: looped }).of({
      kind: "external",
      id: a.id,
    });

    expect(found?.extension.settled).toBe(false);
  });
});

describe("the roan locus", () => {
  it("reads straight off the coat, because roan hides nothing", () => {
    const roanCow = outsider({ name: "A ROAN COW", colour: "Red Roan" });
    const herd: Herd = { profiles: [], outsiders: [roanCow] };

    const found = coatResolver(herd).of({ kind: "external", id: roanCow.id });

    expect(describeLocus(found?.roan as never, ROAN_ALLELES)).toBe("R/r");
    expect(found?.coat).toBe("red roan");
  });
});
