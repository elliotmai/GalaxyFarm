import { describe, expect, it } from "vitest";

import type { ExternalAnimal, FieldChange } from "@galaxy-farm/module-cattle";

import {
  recordInto,
  type Finding,
} from "@/app/(admin)/admin/cattle/ancestors/_components/refresh-all-panel";

/**
 * Folding one page's proposals into what is already on screen (spec §5.2).
 *
 * Shared on purpose between the run and the paste. A herd of thirty ancestors
 * can leave eight pages the server could not read, and those get finished by
 * hand — so a page pasted in has to land in exactly the same place, ticked the
 * same way, as one the server fetched. Two code paths would have drifted, and
 * the difference would only show up as "the ones I pasted did not save".
 */

const animal = (id: string, name: string) =>
  ({ id, name, propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }) as ExternalAnimal;

const change = (field: string, kind: "fill" | "change" = "fill"): FieldChange => ({
  field,
  label: field,
  kind,
  after: "something",
  value: "something",
});

const paper = { association: "AMAA", regNumber: "402303" };

describe("folding a page's proposals in", () => {
  it("adds an animal nothing has proposed for yet", () => {
    const found: Finding[] = [];
    const ticked = new Set<string>();

    recordInto(found, ticked, animal("a", "TYSON"), paper, [change("colour")]);

    expect(found).toHaveLength(1);
    expect(found[0]?.changes.map((entry) => entry.field)).toEqual(["colour"]);
  });

  it("keeps the first page's answer when a second page has the same field", () => {
    // Two rows for one field is a question nobody can answer from a checkbox,
    // and the first page to carry it is as good an answer as the second.
    const found: Finding[] = [];
    const ticked = new Set<string>();
    const tyson = animal("a", "TYSON");

    recordInto(found, ticked, tyson, paper, [{ ...change("colour"), after: "Black" }]);
    recordInto(found, ticked, tyson, { association: "ACA", regNumber: "359968" }, [
      { ...change("colour"), after: "Blk" },
      change("dob"),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.changes.map((entry) => entry.field)).toEqual(["colour", "dob"]);
    expect(found[0]?.changes[0]?.after).toBe("Black");
  });

  it("ticks a blank being filled and leaves a change alone", () => {
    // The rule the whole screen rests on: a blank being filled is agreed to by
    // default, a value being overwritten is not.
    const found: Finding[] = [];
    const ticked = new Set<string>();

    recordInto(found, ticked, animal("a", "TYSON"), paper, [
      change("colour", "fill"),
      change("dob", "change"),
    ]);

    expect([...ticked]).toEqual(["a:colour"]);
  });

  it("does nothing at all for a page with nothing to say", () => {
    const found: Finding[] = [];
    const ticked = new Set<string>();

    recordInto(found, ticked, animal("a", "TYSON"), paper, []);

    expect(found).toEqual([]);
    expect(ticked.size).toBe(0);
  });

  it("keeps different animals apart", () => {
    const found: Finding[] = [];
    const ticked = new Set<string>();

    recordInto(found, ticked, animal("a", "TYSON"), paper, [change("colour")]);
    recordInto(found, ticked, animal("b", "JENNA"), paper, [change("colour")]);

    expect(found.map((entry) => entry.animal.name)).toEqual(["TYSON", "JENNA"]);
    expect([...ticked].sort()).toEqual(["a:colour", "b:colour"]);
  });
});
