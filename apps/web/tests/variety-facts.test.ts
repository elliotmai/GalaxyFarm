import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";
import type { Crop, Variety } from "@galaxy-farm/module-garden";

import { varietyFacts } from "@/lib/garden";

/**
 * How a variety grows (spec §5.5): its crop's figures, its kind's over those
 * when its name says which kind, and its own packet's over everything.
 */

const PEPPER = "01ARZ3NDEKTSV4RRFFQ69G5FC1" as Ulid;
const TOMATO = "01ARZ3NDEKTSV4RRFFQ69G5FC2" as Ulid;

// A crop saved from the old picker: "Pepper", with the generic figures on it.
const crops = [
  { id: PEPPER, name: "Pepper", daysToMaturity: 70, spacingInches: 18 },
  { id: TOMATO, name: "Tomato" },
] as unknown as Crop[];

const variety = (id: string, cropId: Ulid, name: string, own: Partial<Variety> = {}): Variety =>
  ({ id: id as Ulid, cropId, name, ...own }) as Variety;

describe("a variety's growing facts", () => {
  it("grows like the kind its name says, under a generic crop", () => {
    const varieties = [
      variety("v1", PEPPER, "Early Jalapeño"),
      variety("v2", PEPPER, "Red Habanero"),
      variety("v3", PEPPER, "California Wonder"),
    ];

    expect(varietyFacts("v1" as Ulid, varieties, crops)).toMatchObject({
      daysToMaturity: 70,
      spacingInches: 15,
    });
    expect(varietyFacts("v2" as Ulid, varieties, crops)).toMatchObject({
      daysToMaturity: 95,
      startIndoorsWeeks: 10,
    });
    // A name that says no kind keeps the crop's figures.
    expect(varietyFacts("v3" as Ulid, varieties, crops)).toMatchObject({
      daysToMaturity: 70,
      spacingInches: 18,
    });
  });

  it("lets the packet's own figures win over the kind's", () => {
    const varieties = [variety("v1", PEPPER, "Jalapeño M", { daysToMaturity: 65 })];
    expect(varietyFacts("v1" as Ulid, varieties, crops)?.daysToMaturity).toBe(65);
  });

  it("ignores a kind of some other crop", () => {
    // A tomato variety that happens to be called "Banana Pepper Tomato" is
    // still a tomato.
    const varieties = [variety("v1", TOMATO, "Banana Pepper Tomato")];
    expect(varietyFacts("v1" as Ulid, varieties, crops)?.daysToMaturity).toBe(75);
  });
});
