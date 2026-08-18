import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";
import type { Crop, Planting, PreservationLog, Variety } from "@galaxy-farm/module-garden";

import {
  familyHistory,
  familyOf,
  pantryByMethod,
  pantryShelf,
  varietyLabel,
} from "../lib/garden.js";

/**
 * The joins the garden screens read (spec §5.5).
 *
 * The rotation guard is pure and takes a bed-and-family history as an
 * argument, so whatever builds that history decides what the guard can see. A
 * bug here does not throw — it produces a guard that quietly warns about
 * nothing, which is the same as not having one.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const on = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day, 12));

const PROPERTY = id(0);
const BED_A = id(1);
const BED_B = id(2);
const TOMATO = id(10);
const PEPPER = id(11);
const OKRA = id(12);
const CHEROKEE = id(20);
const JALAPENO = id(21);
const CLEMSON = id(22);

const crops: Crop[] = [
  {
    id: TOMATO,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    name: "Tomato",
    family: "Solanaceae",
  },
  {
    id: PEPPER,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    name: "Pepper",
    family: "Solanaceae",
  },
  {
    id: OKRA,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    name: "Okra",
    family: "Malvaceae",
  },
];

const varieties: Variety[] = [
  {
    id: CHEROKEE,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    cropId: TOMATO,
    name: "Cherokee Purple",
  },
  {
    id: JALAPENO,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    cropId: PEPPER,
    name: "Jalapeño",
  },
  {
    id: CLEMSON,
    propertyId: PROPERTY,
    createdAt: on(2026, 1, 1),
    updatedAt: on(2026, 1, 1),
    cropId: OKRA,
    name: "Clemson Spineless",
  },
];

const planting = (overrides: Partial<Planting> & Pick<Planting, "id">): Planting =>
  ({
    propertyId: PROPERTY,
    createdAt: on(2026, 3, 1),
    updatedAt: on(2026, 3, 1),
    bedId: BED_A,
    varietyId: CHEROKEE,
    method: "transplant",
    status: "growing",
    plantedOn: on(2026, 4, 1),
    ...overrides,
  }) as Planting;

const jar = (overrides: Partial<PreservationLog> & Pick<PreservationLog, "id">): PreservationLog =>
  ({
    propertyId: PROPERTY,
    createdAt: on(2026, 8, 1),
    updatedAt: on(2026, 8, 1),
    label: "Salsa",
    method: "canned",
    quantity: 6,
    unit: "jar",
    preservedOn: on(2026, 8, 1),
    ...overrides,
  }) as PreservationLog;

describe("naming a variety", () => {
  it("says the crop alongside it, because a variety name alone is not enough", () => {
    // "Cherokee Purple" is a tomato to somebody who already knows. The screen
    // is also read by whoever is watering while you are away.
    expect(varietyLabel(varieties[0], crops)).toBe("Cherokee Purple · Tomato");
  });

  it("falls back to the bare name when the crop has been deleted", () => {
    expect(varietyLabel(varieties[0], [])).toBe("Cherokee Purple");
  });

  it("says so rather than rendering an empty string for a missing variety", () => {
    expect(varietyLabel(undefined, crops)).toBe("Unknown variety");
  });
});

describe("resolving a family", () => {
  it("reaches the crop's family through the variety", () => {
    expect(familyOf(JALAPENO, varieties, crops)).toBe("Solanaceae");
  });

  it("gives nothing for a variety that is not there", () => {
    expect(familyOf(id(99), varieties, crops)).toBeUndefined();
  });

  it("gives nothing when the variety survives but its crop does not", () => {
    // The rotation guard would otherwise be handed `undefined` as a family and
    // match every other planting whose crop is also gone.
    expect(familyOf(CHEROKEE, varieties, [])).toBeUndefined();
  });
});

describe("the family history a bed carries", () => {
  it("resolves each planting to its botanical family, not its crop name", () => {
    // The whole point: peppers and tomatoes have to land on the same family or
    // the guard never fires on the pairing it exists for.
    const history = familyHistory(
      [
        planting({ id: id(30), varietyId: CHEROKEE, bedId: BED_A, plantedOn: on(2023, 4, 1) }),
        planting({ id: id(31), varietyId: JALAPENO, bedId: BED_A, plantedOn: on(2024, 4, 1) }),
      ],
      varieties,
      crops,
    );

    expect(history.map((entry) => entry.family)).toEqual(["Solanaceae", "Solanaceae"]);
    expect(history.map((entry) => entry.bedId)).toEqual([BED_A, BED_A]);
  });

  it("leaves out a planting that has not gone in the ground yet", () => {
    // A planned row has occupied no bed, so it is not part of that bed's
    // rotation and must not raise a warning about ground nothing has been in.
    const history = familyHistory(
      [planting({ id: id(32), plantedOn: undefined, status: "planned" })],
      varieties,
      crops,
    );

    expect(history).toEqual([]);
  });

  it("leaves out a planting whose variety has been deleted", () => {
    const history = familyHistory([planting({ id: id(33), varietyId: id(98) })], varieties, crops);

    expect(history).toEqual([]);
  });

  it("excludes the planting being edited, so an edit does not warn about itself", () => {
    // Without this, opening any existing planting for a correction reports
    // that its own bed already holds its own family — every time.
    const rows = [
      planting({ id: id(34), bedId: BED_B, plantedOn: on(2026, 4, 1) }),
      planting({ id: id(35), bedId: BED_B, varietyId: JALAPENO, plantedOn: on(2025, 4, 1) }),
    ];

    expect(familyHistory(rows, varieties, crops, id(34)).map((entry) => entry.plantedOn)).toEqual([
      on(2025, 4, 1),
    ]);
  });

  it("keeps every bed's rows, so the caller filters rather than this", () => {
    const history = familyHistory(
      [
        planting({ id: id(36), bedId: BED_A }),
        planting({ id: id(37), bedId: BED_B, varietyId: CLEMSON }),
      ],
      varieties,
      crops,
    );

    expect(history).toHaveLength(2);
  });
});

describe("the pantry shelf", () => {
  it("folds repeat batches of the same thing into one line", () => {
    // Twelve entries of six jars across a summer is seventy-two jars on a
    // shelf, not twelve things to read.
    const shelf = pantryShelf([
      jar({ id: id(40), quantity: 6, preservedOn: on(2026, 7, 1) }),
      jar({ id: id(41), quantity: 6, preservedOn: on(2026, 8, 12) }),
    ]);

    expect(shelf).toHaveLength(1);
    expect(shelf[0]?.quantity).toBe(12);
    expect(shelf[0]?.latest).toEqual(on(2026, 8, 12));
  });

  it("matches labels regardless of how they were capitalised or spaced", () => {
    const shelf = pantryShelf([
      jar({ id: id(42), label: "Green beans" }),
      jar({ id: id(43), label: "  green BEANS " }),
    ]);

    expect(shelf).toHaveLength(1);
    // The first spelling wins, so the shelf reads the way it was first written
    // rather than in whatever case the last entry happened to use.
    expect(shelf[0]?.label).toBe("Green beans");
  });

  it("keeps canned and frozen apart under one label", () => {
    // Different food, different place, different shelf life.
    const shelf = pantryShelf([
      jar({ id: id(44), label: "Green beans", method: "canned", quantity: 6 }),
      jar({ id: id(45), label: "Green beans", method: "frozen", unit: "bag", quantity: 4 }),
    ]);

    expect(shelf).toHaveLength(2);
    expect(shelf.map((line) => line.method)).toEqual(["canned", "frozen"]);
  });

  it("never adds quantities across units", () => {
    // Four bags plus six quarts is not ten of anything.
    const shelf = pantryShelf([
      jar({ id: id(46), unit: "quart", quantity: 6 }),
      jar({ id: id(47), unit: "pint", quantity: 4 }),
    ]);

    expect(shelf.map((line) => `${line.quantity} ${line.unit}`).sort()).toEqual([
      "4 pint",
      "6 quart",
    ]);
  });

  it("collects every place a label is kept, without repeating one", () => {
    const shelf = pantryShelf([
      jar({ id: id(48), storageLocation: "Pantry shelf 2" }),
      jar({ id: id(49), storageLocation: "Pantry shelf 2" }),
      jar({ id: id(50), storageLocation: "Cellar" }),
    ]);

    expect(shelf[0]?.locations).toEqual(["Pantry shelf 2", "Cellar"]);
  });

  it("ignores a blank storage location rather than listing an empty place", () => {
    const shelf = pantryShelf([jar({ id: id(51), storageLocation: "   " })]);

    expect(shelf[0]?.locations).toEqual([]);
  });

  it("reads alphabetically, like a shelf rather than a diary", () => {
    const shelf = pantryShelf([
      jar({ id: id(52), label: "Salsa" }),
      jar({ id: id(53), label: "Applesauce" }),
      jar({ id: id(54), label: "Pickles" }),
    ]);

    expect(shelf.map((line) => line.label)).toEqual(["Applesauce", "Pickles", "Salsa"]);
  });

  it("has nothing to show for an empty pantry", () => {
    expect(pantryShelf([])).toEqual([]);
  });
});

describe("what is put by, by method", () => {
  it("totals each method separately", () => {
    const totals = pantryByMethod([
      jar({ id: id(60), method: "canned", quantity: 6 }),
      jar({ id: id(61), method: "canned", quantity: 6 }),
      jar({ id: id(62), method: "frozen", quantity: 4 }),
    ]);

    expect(totals.get("canned")).toBe(12);
    expect(totals.get("frozen")).toBe(4);
    expect(totals.get("dried")).toBeUndefined();
  });
});
