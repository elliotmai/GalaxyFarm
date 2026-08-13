import { describe, expect, it } from "vitest";

import { parseDigitalBeefPage } from "../src/domain/parsers/digital-beef.js";
import { matchCandidate, mergeRegistration, planImport } from "../src/domain/import-identity.js";
import { allRegistrations, type ExternalAnimal } from "../src/domain/pedigree.js";
import { splitRegistration } from "../src/domain/registries.js";
import { CHIANINA_PAGE } from "./fixtures/chianina-pages.js";
import { MAINE_ANJOU_PAGE } from "./fixtures/maine-anjou-pages.js";

/**
 * One animal, two registries (spec §5.2).
 *
 * ZNT MONTEGO BAY 901W is AMAA 402303 and ACA 359968. His dam, ZNT JENNA 707T,
 * is AMAA 378987 and ACA 337003. Import both his pages against a single
 * registration number and you get two of him and two of her, each copy holding
 * half of what is known — and every relatedness figure computed off whichever
 * half the screen happened to walk.
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

const chianina = () =>
  parseDigitalBeefPage(CHIANINA_PAGE, { association: "ACA", registration: "359968" });
const maine = () =>
  parseDigitalBeefPage(MAINE_ANJOU_PAGE, { association: "AMAA", registration: "402303" });

describe("every number an animal is known by", () => {
  it("reads a record written before there was more than one", () => {
    expect(
      allRegistrations(
        external({ name: "ZNT JENNA 707T", regNumber: "378987", association: "AMAA" }),
      ),
    ).toEqual([{ association: "AMAA", regNumber: "378987" }]);
  });

  it("does not list the same number twice under one registry", () => {
    const animal = external({
      name: "ZNT JENNA 707T",
      regNumber: "*s4219133",
      association: "ASA",
      registrations: [{ association: "ASA", regNumber: "4219133" }],
    });

    // `*s4219133` and `4219133` are one bull. Counting them as two makes him
    // his own half-brother on any chart drawn afterwards.
    expect(allRegistrations(animal)).toHaveLength(1);
  });
});

describe("recognising an animal already on file", () => {
  const jenna = external({ name: "ZNT JENNA 707T", regNumber: "378987", association: "AMAA" });

  it("is certain about the same registry and the same number", () => {
    const match = matchCandidate(
      { name: "ZNT JENNA 707T", regNumber: "378987" },
      "AMAA",
      [jenna],
      new Map([["AMAA:378987", jenna]]),
    );

    expect(match?.confidence).toBe("certain");
  });

  it("does not match a name on its own", () => {
    // Two cows called SWEET DANDY in one county is an ordinary Tuesday. A
    // wrong merge welds two animals' descendants together and nothing on any
    // screen looks unusual afterwards; a duplicate is visible and fixable.
    const match = matchCandidate(
      { name: "ZNT JENNA 707T", regNumber: "337003" },
      "ACA",
      [jenna],
      new Map(),
    );

    expect(match).toBeUndefined();
  });

  it("proposes a merge on a name plus a date of birth", () => {
    const dated = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "402303",
      association: "AMAA",
      dob: new Date("2009-06-19T00:00:00Z"),
    });

    const match = matchCandidate(
      { name: "ZNT MONTEGO BAY 901W", regNumber: "359968", dob: "06/19/2009" },
      "ACA",
      [dated],
      new Map(),
    );

    expect(match?.confidence).toBe("strong");
    expect(match?.addsRegistration).toEqual({ association: "ACA", regNumber: "359968" });
  });

  it("proposes a merge on the same slot beneath a subject that already matched", () => {
    // The Chianina page's dam is 337003; the Maine-Anjou record on file has
    // her as 378987. Nothing about the numbers connects them. The pedigree
    // does: both pages put ZNT JENNA 707T in the dam slot of the same bull.
    const match = matchCandidate(
      { name: "ZNT JENNA 707T", regNumber: "337003", position: "dam" },
      "ACA",
      [jenna],
      new Map(),
      new Map([["dam", jenna]]),
    );

    expect(match?.confidence).toBe("positional");
    expect(match?.addsRegistration).toEqual({ association: "ACA", regNumber: "337003" });
  });
});

describe("planning an import", () => {
  it("marks everything new when the herd is empty", () => {
    const plan = planImport(maine(), []);

    expect(plan.rows).toHaveLength(31);
    expect(plan.rows.every((row) => row.match === undefined)).toBe(true);
  });

  it("recognises a re-import of the same page and proposes nothing new", () => {
    const animal = maine();
    const onFile = [
      external({ name: animal.name as string, regNumber: "402303", association: "AMAA" }),
      // Filed the way the importer files them: under whichever registry issued
      // the number. This page cites three Chianina numbers — `CA240047` and
      // friends — and storing those under AMAA is the duplicate this is meant
      // to prevent.
      ...animal.ancestors.map((ancestor) => {
        const issued =
          ancestor.regNumber === undefined
            ? undefined
            : splitRegistration(ancestor.regNumber, "AMAA");
        return external({
          name: ancestor.name as string,
          ...(issued === undefined ? {} : { regNumber: issued.regNumber }),
          association: issued?.association ?? "AMAA",
        });
      }),
    ];

    const plan = planImport(animal, onFile);

    expect(plan.rows.every((row) => row.match?.confidence === "certain")).toBe(true);
  });

  it("files a cited number under the registry that issued it, not the page it was on", () => {
    // The Maine-Anjou page for ZNT MONTEGO BAY cites his dam's dam's sire as
    // `CA240047`. That is a Chianina number printed on a Maine-Anjou page, and
    // filing it under AMAA makes a second copy of a bull the Chianina import
    // already knows as 240047.
    const plan = planImport(maine(), []);
    const cited = plan.rows.find((row) => row.regNumber === "240047");

    expect(cited?.association).toBe("ACA");
    expect(cited?.citedOn).toBe("AMAA");
    expect(plan.rows.some((row) => row.regNumber === "CA240047")).toBe(false);
  });

  it("joins the second association's page onto the first, slot by slot", () => {
    // The whole point. Maine-Anjou is imported, then Chianina — and the dam,
    // the sire and the grandparents come back as the animals already on file,
    // each with a Chianina number to add, rather than as a second herd.
    const first = maine();
    const bull = external({
      name: first.name as string,
      regNumber: "402303",
      association: "AMAA",
      dob: new Date("2009-06-19T00:00:00Z"),
    });
    const byPosition = new Map<string, ExternalAnimal>();
    const onFile = [bull];

    for (const ancestor of first.ancestors) {
      const record = external({
        name: ancestor.name as string,
        ...(ancestor.regNumber === undefined ? {} : { regNumber: ancestor.regNumber }),
        association: "AMAA",
      });
      onFile.push(record);
      byPosition.set(ancestor.position as string, record);
    }

    const plan = planImport(chianina(), onFile, () => byPosition);

    const subject = plan.rows.find((row) => row.key === "subject");
    expect(subject?.match?.confidence).toBe("strong");

    const dam = plan.rows.find((row) => row.position === "dam");
    expect(dam?.match?.existingName).toBe("ZNT JENNA 707T");
    expect(dam?.match?.addsRegistration).toEqual({ association: "ACA", regNumber: "337003" });

    // Nothing in the chart comes back as a new animal. Every slot is one
    // animal, so the Chianina chart is the same thirty animals under thirty
    // different numbers — which is exactly the duplicate this exists to stop.
    expect(plan.rows.filter((row) => row.match === undefined)).toEqual([]);

    // Where the two registries spell the same slot differently, the merge is
    // still proposed — an animal has one dam — but the disagreement is said
    // out loud rather than folded away. Chianina records this cow as a
    // placeholder for a Maine-Anjou animal it never registered itself.
    const greatGranddam = plan.rows.find((row) => row.position === "dam's dam's dam");
    expect(greatGranddam?.name).toBe("JAZX MAINE ANJOU 352");
    expect(greatGranddam?.match?.reason).toMatch(/different names/);
    expect(greatGranddam?.match?.reason).toMatch(/JAZX MS 720G/);
  });

  it("reports the ancestors whose slot could not be worked out", () => {
    const plan = planImport(
      { ...chianina(), unplacedAncestors: [{ name: "SOMEBODY", geneticTests: [], branch: "x" }] },
      [],
    );

    expect(plan.unplaced.map((row) => row.name)).toEqual(["SOMEBODY"]);
  });
});

describe("folding a number into a record", () => {
  it("adds the new registry and keeps the old one", () => {
    const jenna = external({ name: "ZNT JENNA 707T", regNumber: "378987", association: "AMAA" });

    expect(mergeRegistration(jenna, { association: "ACA", regNumber: "337003" })).toEqual({
      registrations: [
        { association: "AMAA", regNumber: "378987" },
        { association: "ACA", regNumber: "337003" },
      ],
    });
  });

  it("returns nothing to do when the number is already there", () => {
    // So a re-import does not bump `updatedAt` on thirty ancestors and send a
    // whole pedigree back over the wire for no change.
    const jenna = external({ name: "ZNT JENNA 707T", regNumber: "378987", association: "AMAA" });

    expect(mergeRegistration(jenna, { association: "AMAA", regNumber: "378987" })).toBeUndefined();
  });
});
