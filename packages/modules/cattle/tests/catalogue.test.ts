import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import {
  catalogueKey,
  catalogueParentPatch,
  catalogueRecord,
  planCatalogueImport,
} from "../src/domain/catalogue.js";
import type { ExternalAnimal } from "../src/domain/pedigree.js";
import type { RegistryAnimal } from "../src/ports/registry-graph.js";

/**
 * Bringing an animal across from the catalogue (spec §5.2).
 *
 * The catalogue is read-only and enormous; the ancestors on file are a few
 * dozen records somebody maintains by hand. What matters here is the seam: a
 * copy that duplicates a bull already on file forks his descendants across two
 * records, and a copy that overwrites a hand-corrected pedigree loses the
 * correction. Neither shows up on any screen afterwards.
 */

let sequence = 0;
const external = (over: Partial<ExternalAnimal> & { name: string }): ExternalAnimal =>
  ({
    id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(sequence++).padStart(2, "A")}` as Ulid,
    propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" as Ulid,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  }) as ExternalAnimal;

const catalogued = (over: Partial<RegistryAnimal> & { name: string }): RegistryAnimal =>
  ({
    association: "Maine-Anjou",
    regNumber: "402303",
    ...over,
  }) as RegistryAnimal;

const montego = catalogued({
  name: "ZNT MONTEGO BAY 901W",
  regNumber: "402303",
  sex: "male",
  dob: new Date("2009-06-19T00:00:00Z"),
  tattoo: "ZNT901W",
  colour: "Black",
  registrations: [
    { association: "Maine-Anjou", regNumber: "402303" },
    { association: "Chianina", regNumber: "359968" },
  ],
  sire: { association: "Chianina", regNumber: "364424" },
  dam: { association: "Maine-Anjou", regNumber: "378987" },
});

const above = [
  {
    ...catalogued({ name: "MONOPOLY", regNumber: "364424", association: "Chianina" }),
    position: "sire",
    generation: 1,
  },
  {
    ...catalogued({ name: "ZNT JENNA 707T", regNumber: "378987" }),
    position: "dam",
    generation: 1,
  },
  {
    ...catalogued({ name: "OLD GRANDSIRE", regNumber: "111111" }),
    position: "sire's sire",
    generation: 2,
  },
];

describe("planning a copy", () => {
  it("puts the animal first and works outwards a generation at a time", () => {
    // Not cosmetic: a record cannot point at a parent that has not been
    // written, and pedigree order means every parent exists by the time its
    // calf is created.
    const plan = planCatalogueImport(montego, above, []);

    expect(plan.rows.map((row) => row.animal.name)).toEqual([
      "ZNT MONTEGO BAY 901W",
      "MONOPOLY",
      "ZNT JENNA 707T",
      "OLD GRANDSIRE",
    ]);
    expect(plan.rows[0]?.generation).toBe(0);
  });

  it("offers a linebred bull once, at his nearest slot", () => {
    // A bull who is both the sire and the dam's sire is one animal. Offered
    // twice, he is created twice, and half this farm's pedigree hangs off each.
    const twice = [
      ...above,
      {
        ...catalogued({ name: "MONOPOLY", regNumber: "364424", association: "Chianina" }),
        position: "dam's sire",
        generation: 2,
      },
    ];

    const plan = planCatalogueImport(montego, twice, []);

    const monopoly = plan.rows.filter((row) => row.animal.regNumber === "364424");
    expect(monopoly).toHaveLength(1);
    expect(monopoly[0]?.position).toBe("sire");
  });

  it("recognises an animal already on file by registry and number", () => {
    const onFile = external({
      name: "ZNT JENNA 707T",
      regNumber: "378987",
      association: "Maine-Anjou",
    });

    const plan = planCatalogueImport(montego, above, [onFile]);
    const jenna = plan.rows.find((row) => row.animal.regNumber === "378987");

    expect(jenna?.match?.confidence).toBe("certain");
    expect(jenna?.match?.existingId).toBe(onFile.id);
    expect(plan.known).toBe(1);
  });

  it("recognises one filed under a registry's old initials", () => {
    // Records written before registries were named by breed are still on file
    // on any device that has not synced, and a bull matched as new because of
    // it is a bull created twice.
    const onFile = external({
      name: "ZNT JENNA 707T",
      regNumber: "378987",
      association: "AMAA",
    });

    const plan = planCatalogueImport(montego, above, [onFile]);

    expect(plan.rows.find((row) => row.animal.regNumber === "378987")?.match?.confidence).toBe(
      "certain",
    );
  });

  it("proposes rather than assumes a match on name and birthday", () => {
    // A different registry's number for what looks like the same animal. It
    // usually is; a wrong merge is worse than a duplicate, so a person ticks it.
    const onFile = external({
      name: "ZNT MONTEGO BAY 901W",
      regNumber: "999999",
      association: "Shorthorn",
      dob: new Date("2009-06-19T00:00:00Z"),
    });

    const plan = planCatalogueImport(montego, [], [onFile]);

    expect(plan.rows[0]?.match?.confidence).toBe("strong");
    expect(plan.rows[0]?.match?.addsRegistration).toEqual({
      association: "Maine-Anjou",
      regNumber: "402303",
    });
  });

  it("does not match on a shared name alone", () => {
    const plan = planCatalogueImport(montego, [], [external({ name: "ZNT MONTEGO BAY 901W" })]);

    expect(plan.rows[0]?.match).toBeUndefined();
  });
});

describe("the record it would write", () => {
  it("carries every registry the animal is papered in", () => {
    const plan = planCatalogueImport(montego, [], []);
    const record = catalogueRecord(plan.rows[0] as never);

    expect(record.registrations).toEqual([
      { association: "Maine-Anjou", regNumber: "402303" },
      { association: "Chianina", regNumber: "359968" },
    ]);
  });

  it("falls back to the number it was found under", () => {
    const plan = planCatalogueImport(catalogued({ name: "PLAIN", regNumber: "1" }), [], []);
    const record = catalogueRecord(plan.rows[0] as never);

    expect(record.registrations).toEqual([{ association: "Maine-Anjou", regNumber: "1" }]);
  });

  it("says where it came from and which slot it filled", () => {
    const plan = planCatalogueImport(montego, above, []);
    const sire = plan.rows.find((row) => row.position === "sire");

    expect(catalogueRecord(sire as never).notes).toBe("From the Chianina catalogue · sire");
  });
});

describe("joining the copies up", () => {
  it("points at the records this import created", () => {
    const plan = planCatalogueImport(montego, above, []);
    const ids = new Map<string, Ulid>([
      [catalogueKey("Chianina", "364424"), "01ARZ3NDEKTSV4RRFFQ69G5FB1" as Ulid],
      [catalogueKey("Maine-Anjou", "378987"), "01ARZ3NDEKTSV4RRFFQ69G5FB2" as Ulid],
    ]);

    expect(catalogueParentPatch(plan.rows[0] as never, ids)).toEqual({
      sire: { kind: "external", id: "01ARZ3NDEKTSV4RRFFQ69G5FB1" },
      dam: { kind: "external", id: "01ARZ3NDEKTSV4RRFFQ69G5FB2" },
    });
  });

  it("leaves out a parent that was not brought across", () => {
    // A reference to an id that was never created breaks the pedigree walk
    // everywhere it is followed. "No sire on file" is at least true.
    const plan = planCatalogueImport(montego, above, []);
    const ids = new Map<string, Ulid>([
      [catalogueKey("Maine-Anjou", "378987"), "01ARZ3NDEKTSV4RRFFQ69G5FB2" as Ulid],
    ]);

    expect(catalogueParentPatch(plan.rows[0] as never, ids)).toEqual({
      dam: { kind: "external", id: "01ARZ3NDEKTSV4RRFFQ69G5FB2" },
    });
  });

  it("never overwrites a parent somebody already put there", () => {
    // The pedigree corrected by hand is worth more than the crawl, and this is
    // the field somebody corrects.
    const plan = planCatalogueImport(montego, above, []);
    const ids = new Map<string, Ulid>([
      [catalogueKey("Chianina", "364424"), "01ARZ3NDEKTSV4RRFFQ69G5FB1" as Ulid],
      [catalogueKey("Maine-Anjou", "378987"), "01ARZ3NDEKTSV4RRFFQ69G5FB2" as Ulid],
    ]);

    const patch = catalogueParentPatch(plan.rows[0] as never, ids, {
      sire: { kind: "external", id: "01ARZ3NDEKTSV4RRFFQ69G5FZZ" as Ulid },
    });

    expect(patch).toEqual({ dam: { kind: "external", id: "01ARZ3NDEKTSV4RRFFQ69G5FB2" } });
  });

  it("asks for no write at all when there is nothing to join", () => {
    const plan = planCatalogueImport(catalogued({ name: "PLAIN", regNumber: "1" }), [], []);

    expect(catalogueParentPatch(plan.rows[0] as never, new Map())).toBeUndefined();
  });
});
