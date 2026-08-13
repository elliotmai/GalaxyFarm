import { describe, expect, it } from "vitest";

import { planImport } from "../src/domain/import-identity.js";
import { parseDigitalBeefPage } from "../src/domain/parsers/digital-beef.js";
import {
  applyChanges,
  defaultAccepted,
  pedigreeChanges,
  profileChanges,
  refreshChanges,
  unknownOnChart,
} from "../src/domain/refresh.js";
import type { CattleProfile } from "../src/domain/cattle-profile.js";
import type { ExternalAnimal } from "../src/domain/pedigree.js";
import { CHIANINA_PAGE } from "./fixtures/chianina-pages.js";
import { MAINE_ANJOU_PAGE } from "./fixtures/maine-anjou-pages.js";
import { SHORTHORN_PAGE } from "./fixtures/shorthorn-pages.js";

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
  parseDigitalBeefPage(MAINE_ANJOU_PAGE, { association: "Maine-Anjou", registration: "402303" });

describe("what a fresh read would change", () => {
  it("proposes filling in what the record does not have", () => {
<<<<<<< HEAD
    const thin = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
    });
=======
    const thin = external({ name: "ZNT MONTEGO BAY 901W", regNumber: "402303", association: "Maine-Anjou" });
>>>>>>> 77ed80d (Name a registry by its breed, not the association's initials)
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
      association: "Maine-Anjou",
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
      association: "Maine-Anjou",
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
      association: "Maine-Anjou",
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
      association: "Chianina",
    });

    const change = refreshChanges(chianinaOnly, page()).find(
      (entry) => entry.field === "registrations",
    );

    expect(change?.after).toContain("Chianina 359968");
    expect(change?.after).toContain("Maine-Anjou 402303");
  });

  it("does not offer a registration it already holds", () => {
    const held = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "Maine-Anjou",
    });

    expect(refreshChanges(held, page()).some((entry) => entry.field === "registrations")).toBe(
      false,
    );
  });

  it("notices a culled bull that is still recorded as active", () => {
    const stale = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "Maine-Anjou",
      status: "Active",
    });

    expect(refreshChanges(stale, page()).find((change) => change.field === "status")).toMatchObject(
      {
        kind: "change",
        before: "Active",
        after: "Culled - Culled - age",
      },
    );
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
    parseDigitalBeefPage(CHIANINA_PAGE, { association: "Chianina", registration: "359968" });

  it("finds the defect results, which are only ever on a descendant's chart", () => {
    // The bug this covers: Digital Beef never prints an animal's own genetic
    // tests on its own page. It prints them beside it on the pedigree of
    // everything descended from it. A refresh that only read the detail panel
    // reported "nothing has changed" for a whole herd, every time, without
    // ever saying it had looked somewhere they could not be.
    const tyson = external({ name: "CMAC TYSON ET", regNumber: "MA364424", association: "Chianina" });

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
      association: "Maine-Anjou",
    });

    expect(pedigreeChanges(chianina(), [wrongRegistry])).toEqual([]);
  });

  it("keeps a result already on file and adds only what is new", () => {
    // A hair card typed in here for TH has to survive a page that says
    // something about PHA.
    const tested = external({
      name: "CMAC TYSON ET",
      regNumber: "MA364424",
      association: "Chianina",
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
      association: "Chianina",
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
    const thin = external({ name: "COWAN'S ALI 4M", regNumber: "MA307184", association: "Chianina" });
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
      association: "Shorthorn",
      registration: "4219133",
    });
    const leader = external({
      name: "CORONET MAX LEADER",
      regNumber: "x2887446",
      association: "Shorthorn",
    });

    const [finding] = pedigreeChanges(shorthorn, [leader]);

    expect(finding?.changes.find((change) => change.field === "colour")?.after).toBe("Roan");
    expect(finding?.changes.find((change) => change.field === "dob")).toBeDefined();
  });

  it("never proposes overwriting something already recorded", () => {
    const corrected = external({
      name: "CORONET MAX LEADER",
      regNumber: "x2887446",
      association: "Shorthorn",
      colour: "Roan with a white face",
    });
    const shorthorn = parseDigitalBeefPage(SHORTHORN_PAGE, {
      association: "Shorthorn",
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
      association: "Chianina",
    });
    const changes = refreshChanges(
      montego,
      parseDigitalBeefPage(CHIANINA_PAGE, { association: "Chianina", registration: "359968" }),
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
      association: "Maine-Anjou",
    });

    expect(
      refreshChanges(montego, page()).some((change) => change.field === "breedComposition"),
    ).toBe(false);
  });
});

describe("wiring the parents a page names", () => {
  const tyson = external({ name: "CMAC TYSON ET", regNumber: "364424", association: "Maine-Anjou" });
  const jenna = external({ name: "ZNT JENNA 707T", regNumber: "378987", association: "Maine-Anjou" });

  it("links a sire and dam the record does not have yet", () => {
    // The detail panel names both outright. An ancestor entered by hand off a
    // certificate has no parents linked, and its own page is where that gets
    // fixed — until now the refresh read them and did nothing with them.
    const orphan = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "Maine-Anjou",
    });

    const changes = refreshChanges(orphan, page(), [tyson, jenna]);

    expect(changes.find((change) => change.field === "sire")).toMatchObject({
      kind: "fill",
      value: { kind: "external", id: tyson.id },
    });
    expect(changes.find((change) => change.field === "dam")?.value).toEqual({
      kind: "external",
      id: jenna.id,
    });
  });

  it("never re-points a parent that is already set", () => {
    // Re-pointing would rewrite a pedigree somebody built by hand, on the
    // strength of a page that may be recording the same animal under another
    // number.
    const wired = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "Maine-Anjou",
      sire: { kind: "external", id: "01ARZ3NDEKTSV4RRFFQ69G5FZZ" as never },
    });

    expect(refreshChanges(wired, page(), [tyson, jenna]).some((c) => c.field === "sire")).toBe(
      false,
    );
  });

  it("proposes nothing when the parent is not on file", () => {
<<<<<<< HEAD
    const orphan = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
    });
=======
    const orphan = external({ name: "ZNT MONTEGO BAY 901W", regNumber: "402303", association: "Maine-Anjou" });
>>>>>>> 77ed80d (Name a registry by its breed, not the association's initials)

    expect(refreshChanges(orphan, page(), []).some((c) => c.field === "sire")).toBe(false);
  });

  it("will not guess between two animals of the same name", () => {
    // Two cows called SWEET DANDY in one county is an ordinary Tuesday, and a
    // pedigree pointed at the wrong one looks entirely normal afterwards.
    const one = external({ name: "CMAC TYSON ET" });
    const two = external({ name: "CMAC TYSON ET" });
<<<<<<< HEAD
    const orphan = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
    });
=======
    const orphan = external({ name: "ZNT MONTEGO BAY 901W", regNumber: "402303", association: "Maine-Anjou" });
>>>>>>> 77ed80d (Name a registry by its breed, not the association's initials)

    expect(refreshChanges(orphan, page(), [one, two]).some((c) => c.field === "sire")).toBe(false);
  });

  it("matches on the registry whose page it is", () => {
    // 364424 under Chianina is a different animal from 364424 under
    // Maine-Anjou.
    const wrongRegistry = external({
      name: "SOMEBODY ELSE",
      regNumber: "364424",
      association: "Chianina",
    });
<<<<<<< HEAD
    const orphan = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
    });
=======
    const orphan = external({ name: "ZNT MONTEGO BAY 901W", regNumber: "402303", association: "Maine-Anjou" });
>>>>>>> 77ed80d (Name a registry by its breed, not the association's initials)

    expect(refreshChanges(orphan, page(), [wrongRegistry]).some((c) => c.field === "sire")).toBe(
      false,
    );
  });
});

describe("the farm's own animals", () => {
  const profile = (over: Partial<CattleProfile> = {}): CattleProfile =>
    ({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FP1",
      propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      animalId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      breedComposition: [],
      geneticTests: [],
      registrations: [],
      ...over,
    }) as CattleProfile;

  const chianina = () =>
    parseDigitalBeefPage(CHIANINA_PAGE, { association: "Chianina", registration: "359968" });

  it("takes the breed makeup off the papers", () => {
    // The gap this covers: the farm's own pages were being read only for what
    // the chart said about the ancestors above them, so the animals whose
    // composition matters most — the ones bred, shown and sold — were the ones
    // a refresh never touched.
    const change = profileChanges(profile(), chianina()).find(
      (entry) => entry.field === "breedComposition",
    );

    expect(change?.kind).toBe("fill");
    expect(change?.after).toContain("79.57% MA");
  });

  it("treats an empty makeup as no makeup", () => {
    // `breedComposition` defaults to `[]`, and reading that as "already
    // answered" is why a papered animal with none on file would never gain one.
    expect(
      profileChanges(profile({ breedComposition: [] }), chianina()).some(
        (entry) => entry.field === "breedComposition",
      ),
    ).toBe(true);
  });

  it("reports a makeup that differs rather than replacing it", () => {
    const change = profileChanges(
      profile({ breedComposition: [{ breed: "MA", percent: 100 }] }),
      chianina(),
    ).find((entry) => entry.field === "breedComposition");

    expect(change?.kind).toBe("change");
    expect(change?.before).toContain("100% MA");
  });

  it("reads the horn status into the vocabulary the record uses", () => {
    // The page prints "Polled"; the record stores `polled`.
    expect(
      profileChanges(profile(), chianina()).find((entry) => entry.field === "hornStatus")?.value,
    ).toBe("polled");
  });

  it("says nothing when the record already agrees", () => {
    const current = profile({
      breedComposition: [
        { breed: "CA", percent: 3.72 },
        { breed: "MA", percent: 79.57 },
        { breed: "AN", percent: 14.41 },
        { breed: "XX", percent: 2.3 },
      ],
      colour: "Black",
      hornStatus: "polled",
    });

    expect(profileChanges(current, chianina())).toEqual([]);
  });

  it("does not propose emptying a makeup the page does not carry", () => {
    // A Maine-Anjou page prints none at all.
    const known = profile({ breedComposition: [{ breed: "MA", percent: 79.57 }] });

    expect(profileChanges(known, page()).some((entry) => entry.field === "breedComposition")).toBe(
      false,
    );
  });
});

describe("what a chart offers that is not on file", () => {
  it("names the animals an import would add", () => {
    // A refresh does not create records — importing does, and it shows every
    // one for approval. But saying nothing leaves somebody thinking the page
    // had nothing to give when it named thirty ancestors.
    const strangers = unknownOnChart(page(), []);

    expect(strangers).toContain("CMAC TYSON ET");
    expect(strangers.length).toBeGreaterThan(20);
  });

  it("counts nothing when every one is already here", () => {
    const read = page();
    const herd = read.ancestors
      .filter((entry) => entry.regNumber !== undefined)
      .map((entry) =>
        external({
          name: entry.name as string,
          regNumber: entry.regNumber as string,
          association: "Maine-Anjou",
        }),
      );

    expect(unknownOnChart(read, herd)).toEqual([]);
  });
});

describe("what the chart says about the ancestors on it", () => {
  /**
   * The end-to-end check, and the one that was missing.
   *
   * Three separate rounds of "the refresh still is not getting the defects"
   * came down to a lookup key: the importer files an ancestor under the
   * registry that issued its number, and the refresh looked it up under the
   * registry whose page it was printed on. On a Chianina page most ancestors
   * carry Maine-Anjou numbers, so most of them missed — and the chart is the
   * *only* place an association prints an ancestor's defect results.
   *
   * Asserting the count rather than a sample is deliberate. "Some defects came
   * through" was true the whole time it was broken.
   */
  const imported = () =>
    parseDigitalBeefPage(CHIANINA_PAGE, { association: "Chianina", registration: "359968" });

  /** The herd exactly as the import screen would have written it. */
  const asImported = (page: ReturnType<typeof imported>) =>
    planImport(page, [])
      .rows.filter((row) => row.ancestor !== undefined)
      .map((row) =>
        external({
          name: row.name,
          ...(row.regNumber === undefined ? {} : { regNumber: row.regNumber }),
          association: row.association,
        }),
      );

  it("proposes results for every ancestor on the chart that has any", () => {
    const page = imported();
    const herd = asImported(page);

    const carrying = new Set(
      page.ancestors.filter((entry) => entry.geneticTests.length > 0).map((entry) => entry.name),
    );
    const proposed = pedigreeChanges(page, herd).filter((entry) =>
      entry.changes.some((change) => change.field === "geneticTests"),
    );

    expect(carrying.size).toBeGreaterThan(5);
    expect(proposed).toHaveLength(carrying.size);
  });

  it("finds an ancestor filed under the registry that issued its number", () => {
    // `MA364424` on this Chianina page is Maine-Anjou 364424, and that is
    // where the importer put him.
    const page = imported();
    const tyson = external({ name: "CMAC TYSON ET", regNumber: "364424", association: "Maine-Anjou" });

    expect(pedigreeChanges(page, [tyson])).toHaveLength(1);
  });

  it("still finds one filed the old way, under the page it arrived on", () => {
    // Records written before the prefix was understood are filed under the
    // printing registry with the tag still on the number. They keep working.
    const page = imported();
    const tyson = external({ name: "CMAC TYSON ET", regNumber: "MA364424", association: "Chianina" });

    expect(pedigreeChanges(page, [tyson])).toHaveLength(1);
  });

  it("does not count an animal it already knows as a stranger", () => {
    const page = imported();

    expect(unknownOnChart(page, asImported(page))).toEqual([]);
  });
});
