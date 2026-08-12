import { describe, expect, it } from "vitest";

import { parseDigitalBeefPage } from "../src/domain/digital-beef.js";
import { applyChanges, defaultAccepted, refreshChanges } from "../src/domain/refresh.js";
import type { ExternalAnimal } from "../src/domain/pedigree.js";
import { MAINE_ANJOU_PAGE } from "./fixtures/digital-beef-pages.js";

/**
 * Checking an animal against its association again (spec §5.2).
 *
 * A registry is not a snapshot. A bull gets culled, a hair card comes back, a
 * birth date gets corrected. The one rule the whole thing rests on: **a
 * refresh proposes, it does not overwrite.** Anything on file may have been
 * typed or corrected by hand, and a re-read of a page built for a person to
 * look at is not evidence against that — one bad parse after a template change
 * would otherwise rewrite thirty records with nothing on screen looking
 * unusual.
 */

let sequence = 0;
const external = (over: Partial<ExternalAnimal> & { name: string }): ExternalAnimal =>
  ({
    id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(sequence++).padStart(2, "A")}`,
    propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  }) as ExternalAnimal;

const page = () =>
  parseDigitalBeefPage(MAINE_ANJOU_PAGE, { association: "AMAA", registration: "402303" });

describe("what a fresh read would change", () => {
  it("proposes filling in what the record does not have", () => {
    const thin = external({ name: "ZNT MONTEGO BAY 901W", regNumber: "402303", association: "AMAA" });
    const changes = refreshChanges(thin, page());

    expect(changes.map((change) => change.field)).toEqual(
      expect.arrayContaining(["tattoo", "sex", "dob", "colour", "hornStatus", "status"]),
    );
    expect(changes.every((change) => change.kind === "fill")).toBe(true);
  });

  it("marks a value that would be replaced as a change, with both sides", () => {
    const corrected = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
      colour: "Black with a white foot",
    });

    const colour = refreshChanges(corrected, page()).find((change) => change.field === "colour");

    expect(colour).toMatchObject({
      kind: "change",
      before: "Black with a white foot",
      after: "Black",
    });
  });

  it("says nothing when the record already agrees", () => {
    const current = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
      colour: "Black",
    });

    expect(refreshChanges(current, page()).some((change) => change.field === "colour")).toBe(false);
  });

  it("does not propose emptying a field the page does not carry", () => {
    // The Maine-Anjou page prints no breed makeup at all. Reading that as "the
    // makeup is now nothing" would wipe the one the Chianina page supplied.
    const known = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
      breedComposition: [{ breed: "MA", percent: 79.57 }],
    });

    expect(
      refreshChanges(known, page()).some((change) => change.field === "breedComposition"),
    ).toBe(false);
  });

  it("offers a registration the record does not hold yet, keeping the old one", () => {
    const chianinaOnly = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "359968",
      association: "ACA",
    });

    const change = refreshChanges(chianinaOnly, page()).find(
      (entry) => entry.field === "registrations",
    );

    expect(change?.after).toContain("ACA 359968");
    expect(change?.after).toContain("AMAA 402303");
  });

  it("does not offer a registration it already holds", () => {
    const held = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
    });

    expect(refreshChanges(held, page()).some((entry) => entry.field === "registrations")).toBe(
      false,
    );
  });

  it("notices a culled bull that is still recorded as active", () => {
    const stale = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
      status: "Active",
    });

    expect(refreshChanges(stale, page()).find((change) => change.field === "status")).toMatchObject({
      kind: "change",
      before: "Active",
      after: "Culled - Culled - age",
    });
  });
});

describe("what gets ticked", () => {
  const changes = [
    { field: "colour", label: "Colour", kind: "fill" as const, after: "Black", value: "Black" },
    {
      field: "status",
      label: "Status",
      kind: "change" as const,
      before: "Active",
      after: "Culled",
      value: "Culled",
    },
  ];

  it("ticks blanks and leaves replacements alone", () => {
    // The asymmetry is the point. Filling a blank cannot lose anything;
    // replacing a value can lose a hand correction.
    expect([...defaultAccepted(changes)]).toEqual(["colour"]);
  });

  it("writes only what was ticked", () => {
    expect(applyChanges(changes, new Set(["colour"]))).toEqual({ colour: "Black" });
    expect(applyChanges(changes, new Set(["colour", "status"]))).toEqual({
      colour: "Black",
      status: "Culled",
    });
  });

  it("writes nothing when nothing is ticked", () => {
    expect(applyChanges(changes, new Set())).toEqual({});
  });
});
