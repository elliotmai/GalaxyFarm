import { describe, expect, it } from "vitest";

import { parseDigitalBeefPage } from "../src/domain/digital-beef.js";
import {
  applyChanges,
  defaultAccepted,
  pedigreeChanges,
  refreshChanges,
} from "../src/domain/refresh.js";
import type { ExternalAnimal } from "../src/domain/pedigree.js";
import {
  CHIANINA_PAGE,
  MAINE_ANJOU_PAGE,
  SHORTHORN_PAGE,
} from "./fixtures/digital-beef-pages.js";

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

describe("what a page says about the other animals on it", () => {
  const chianina = () =>
    parseDigitalBeefPage(CHIANINA_PAGE, { association: "ACA", registration: "359968" });

  it("finds the defect results, which are only ever on a descendant's chart", () => {
    // The bug this covers: Digital Beef never prints an animal's own genetic
    // tests on its own page. It prints them beside it on the pedigree of
    // everything descended from it. A refresh that only read the detail panel
    // reported "nothing has changed" for a whole herd, every time, without
    // ever saying it had looked somewhere they could not be.
    const tyson = external({ name: "CMAC TYSON ET", regNumber: "MA364424", association: "ACA" });

    const [finding] = pedigreeChanges(chianina(), [tyson]);
    const defects = finding?.changes.find((change) => change.field === "geneticTests");

    expect(defects?.after).toContain("PHA free");
    expect(defects?.after).toContain("TH free");
    expect(defects?.after).toContain("AM suspect");
  });

  it("matches on the registry whose page it is, not on the number alone", () => {
    // 337003 is ZNT JENNA's *Chianina* number. The same digits under
    // Maine-Anjou would be a different animal entirely.
    const wrongRegistry = external({
      name: "ZNT JENNA 707T",
      regNumber: "337003",
      association: "AMAA",
    });

    expect(pedigreeChanges(chianina(), [wrongRegistry])).toEqual([]);
  });

  it("keeps a result already on file and adds only what is new", () => {
    // A hair card typed in here for TH has to survive a page that says
    // something about PHA.
    const tested = external({
      name: "CMAC TYSON ET",
      regNumber: "MA364424",
      association: "ACA",
      geneticTests: [{ defect: "TH", status: "carrier" }],
    });

    const [finding] = pedigreeChanges(chianina(), [tested]);
    const defects = finding?.changes.find((change) => change.field === "geneticTests");

    expect(defects?.after).toContain("TH carrier");
    expect(defects?.after).not.toContain("TH free");
  });

  it("proposes nothing for an animal whose results are all already recorded", () => {
    const complete = external({
      name: "COWAN'S ALI 4M",
      regNumber: "MA307184",
      association: "ACA",
      tattoo: "COWN4M",
      geneticTests: [
        { defect: "PHA", status: "free" },
        { defect: "TH", status: "free" },
      ],
      sex: "male",
    });

    expect(pedigreeChanges(chianina(), [complete])).toEqual([]);
  });

  it("takes the tattoo and the sex off the slot as well", () => {
    const thin = external({ name: "COWAN'S ALI 4M", regNumber: "MA307184", association: "ACA" });
    const [finding] = pedigreeChanges(chianina(), [thin]);
    const fields = (finding?.changes ?? []).map((change) => change.field);

    expect(fields).toEqual(expect.arrayContaining(["tattoo", "sex", "geneticTests"]));
    // `sire's sire` ends in "sire", so he is a bull.
    expect(finding?.changes.find((change) => change.field === "sex")?.after).toBe("male");
  });

  it("reads colour and birth date off a Shorthorn chart", () => {
    // Shorthorn prints both under every entry, going back to a roan bull born
    // in 1955 — the only record of either that exists anywhere.
    const shorthorn = parseDigitalBeefPage(SHORTHORN_PAGE, {
      association: "ASA",
      registration: "4219133",
    });
    const leader = external({
      name: "CORONET MAX LEADER",
      regNumber: "x2887446",
      association: "ASA",
    });

    const [finding] = pedigreeChanges(shorthorn, [leader]);

    expect(finding?.changes.find((change) => change.field === "colour")?.after).toBe("Roan");
    expect(finding?.changes.find((change) => change.field === "dob")).toBeDefined();
  });

  it("never proposes overwriting something already recorded", () => {
    const corrected = external({
      name: "CORONET MAX LEADER",
      regNumber: "x2887446",
      association: "ASA",
      colour: "Roan with a white face",
    });
    const shorthorn = parseDigitalBeefPage(SHORTHORN_PAGE, {
      association: "ASA",
      registration: "4219133",
    });

    const [finding] = pedigreeChanges(shorthorn, [corrected]);

    expect(finding?.changes.some((change) => change.field === "colour")).toBe(false);
  });
});

describe("the breed makeup a refresh can actually find", () => {
  it("comes off a Chianina page, which is the only one that prints it", () => {
    const montego = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "359968",
      association: "ACA",
    });
    const changes = refreshChanges(
      montego,
      parseDigitalBeefPage(CHIANINA_PAGE, { association: "ACA", registration: "359968" }),
    );

    expect(changes.find((change) => change.field === "breedComposition")?.after).toContain(
      "79.57% MA",
    );
  });

  it("is absent from a Maine-Anjou page, so checking only that one finds none", () => {
    // Which is why the bulk check reads *every* registry an animal is papered
    // in rather than stopping at the first: a dual-registered animal whose
    // Maine-Anjou number happened to be first came back with no breeding.
    const montego = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
    });

    expect(
      refreshChanges(montego, page()).some((change) => change.field === "breedComposition"),
    ).toBe(false);
  });
});
