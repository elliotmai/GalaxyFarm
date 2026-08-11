import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import {
  bedAreaSqFt,
  bedSchema,
  cropSchema,
  isStaleSeed,
  seedInventorySchema,
  varietySchema,
} from "../src/domain/beds.js";
import {
  DEFAULT_ROTATION_YEARS,
  expectedHarvestDate,
  gardenCareLogSchema,
  harvestLogSchema,
  plantingSchema,
  preservationLogSchema,
  rotationWarning,
  totalHarvest,
} from "../src/domain/planting.js";
import {
  frostDatesFor,
  isInGrowingSeason,
  plannedPlantingSchema,
  plantingToActual,
  plantingWindows,
  seasonPlanSchema,
  type PlannedPlanting,
} from "../src/domain/season-plan.js";

/** The garden (spec §5.5, Phase 3). */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2027-03-01T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

describe("beds and crops", () => {
  const bed = {
    id: id(1),
    ...base,
    zoneId: id(90),
    name: "Bed 1",
    type: "raised_bed" as const,
    lengthFt: 8,
    widthFt: 4,
    active: true,
  };

  it("accepts a bed and computes its area", () => {
    expect(bedSchema.safeParse(bed).success).toBe(true);
    expect(bedAreaSqFt(bed)).toBe(32);
  });

  it("says nothing about the area of a bed with no dimensions", () => {
    expect(bedAreaSqFt({ lengthFt: 8 })).toBeUndefined();
  });

  it("demands a botanical family on a crop", () => {
    // Tomatoes and peppers are both nightshades, and a rotation checked on the
    // crop name would happily follow one with the other.
    const crop = { id: id(2), ...base, name: "Tomato", family: "" };
    expect(cropSchema.safeParse(crop).success).toBe(false);
    expect(cropSchema.safeParse({ ...crop, family: "Solanaceae" }).success).toBe(true);
  });

  it("accepts a variety with nothing but a name", () => {
    const variety = { id: id(3), ...base, cropId: id(2), name: "Cherokee Purple" };
    expect(varietySchema.safeParse(variety).success).toBe(true);
  });
});

describe("isStaleSeed", () => {
  it("flags seed more than two seasons past its year", () => {
    // Not an expiry — most seed keeps far longer than the packet says. Worth
    // testing germination before committing a bed to it.
    expect(isStaleSeed({ packedForYear: 2024 }, AT)).toBe(true);
    expect(isStaleSeed({ packedForYear: 2025 }, AT)).toBe(false);
  });

  it("says nothing about seed with no year on it", () => {
    expect(isStaleSeed({}, AT)).toBe(false);
  });

  it("accepts an empty packet, since zero is a real count", () => {
    const seed = { id: id(4), ...base, varietyId: id(3), quantity: 0, unit: "packet" as const };
    expect(seedInventorySchema.safeParse(seed).success).toBe(true);
  });
});

describe("expectedHarvestDate", () => {
  it("counts from the day it went in the ground", () => {
    // Days to maturity on a packet is measured from transplant for a
    // transplanted crop; counting from the seed tray puts tomatoes six weeks
    // early.
    const planting = {
      method: "transplant" as const,
      indoorStartedOn: new Date("2027-02-01"),
      plantedOn: new Date("2027-04-15"),
    };

    expect(expectedHarvestDate(planting, { daysToMaturity: 80 })).toEqual(
      new Date("2027-07-04T00:00:00Z"),
    );
  });

  it("says nothing without a maturity figure", () => {
    expect(expectedHarvestDate({ method: "direct_sow", plantedOn: AT }, {})).toBeUndefined();
  });

  it("says nothing for a transplant still in the tray", () => {
    const planting = { method: "transplant" as const, indoorStartedOn: new Date("2027-02-01") };
    expect(expectedHarvestDate(planting, { daysToMaturity: 80 })).toBeUndefined();
  });
});

describe("plantingSchema", () => {
  it("refuses a transplant dated before it was started", () => {
    const planting = {
      id: id(10),
      ...base,
      bedId: id(1),
      varietyId: id(3),
      method: "transplant" as const,
      indoorStartedOn: new Date("2027-04-01"),
      plantedOn: new Date("2027-02-01"),
      status: "growing" as const,
    };

    expect(plantingSchema.safeParse(planting).success).toBe(false);
  });
});

describe("rotationWarning", () => {
  const history = [
    { bedId: id(1), family: "Solanaceae", plantedOn: new Date("2026-04-20") },
    { bedId: id(2), family: "Brassicaceae", plantedOn: new Date("2026-04-20") },
  ];

  it("warns when the same family returns too soon", () => {
    const warning = rotationWarning(id(1), "Solanaceae", history, AT);
    expect(warning?.yearsSince).toBeLessThan(DEFAULT_ROTATION_YEARS);
  });

  it("catches peppers following tomatoes, which share a family and not a name", () => {
    // The exact mistake rotation exists to prevent.
    expect(rotationWarning(id(1), "Solanaceae", history, AT)).toBeDefined();
  });

  it("stays quiet once the window has passed", () => {
    expect(rotationWarning(id(1), "Solanaceae", history, new Date("2030-03-01"))).toBeUndefined();
  });

  it("stays quiet about a different bed", () => {
    expect(rotationWarning(id(9), "Solanaceae", history, AT)).toBeUndefined();
  });

  it("stays quiet about a family never planted there", () => {
    expect(rotationWarning(id(1), "Cucurbitaceae", history, AT)).toBeUndefined();
  });
});

describe("harvest and preservation", () => {
  const harvest = {
    id: id(20),
    ...base,
    plantingId: id(10),
    harvestedOn: new Date("2027-07-10"),
    quantity: 6.5,
    unit: "lb" as const,
  };

  it("totals a planting's yield by unit", () => {
    const second = { ...harvest, id: id(21), quantity: 3.5 };
    expect(totalHarvest([harvest, second], id(10)).get("lb")).toBe(10);
  });

  it("keeps units apart rather than adding pounds to bunches", () => {
    const bunches = { ...harvest, id: id(22), quantity: 4, unit: "bunch" as const };
    const totals = totalHarvest([harvest, bunches], id(10));

    expect(totals.get("lb")).toBe(6.5);
    expect(totals.get("bunch")).toBe(4);
  });

  it("accepts a harvest and a jar", () => {
    expect(harvestLogSchema.safeParse(harvest).success).toBe(true);

    const jars = {
      id: id(30),
      ...base,
      label: "Tomato sauce",
      method: "canned" as const,
      quantity: 7,
      unit: "quart" as const,
      preservedOn: new Date("2027-07-12"),
    };
    expect(preservationLogSchema.safeParse(jars).success).toBe(true);
  });

  it("refuses a care log attached to neither a bed nor a planting", () => {
    const log = {
      id: id(40),
      ...base,
      action: "weed" as const,
      performedOn: AT,
    };
    expect(gardenCareLogSchema.safeParse(log).success).toBe(false);
  });
});

// ---------------------------------------------------------------- season plan

const planned = (over: Partial<PlannedPlanting> = {}): PlannedPlanting => ({
  id: id(50),
  ...base,
  seasonPlanId: id(51),
  varietyId: id(3),
  method: "indoor_start",
  bedId: id(1),
  windowFrom: new Date("2027-03-05"),
  windowTo: new Date("2027-03-20"),
  planStatus: "open",
  ...over,
});

describe("plantingWindows", () => {
  it("raises a window opening inside the lead time", () => {
    expect(plantingWindows([planned()], AT, 7)).toHaveLength(1);
  });

  it("says whether it is open yet or still ahead", () => {
    expect(plantingWindows([planned()], AT, 7)[0]?.open).toBe(false);
    expect(plantingWindows([planned()], new Date("2027-03-10"), 7)[0]?.open).toBe(true);
  });

  it("flags one about to close", () => {
    expect(plantingWindows([planned()], new Date("2027-03-15"), 7)[0]?.closingSoon).toBe(true);
  });

  it("raises nothing for a plan already realised", () => {
    // §5.5: notifications fire for what is in the plan, not the seed catalogue,
    // and a plan already acted on is no longer in it.
    expect(plantingWindows([planned({ planStatus: "realised" })], AT, 7)).toEqual([]);
  });

  it("raises nothing for a window that has already closed", () => {
    expect(plantingWindows([planned()], new Date("2027-04-01"), 7)).toEqual([]);
  });

  it("refuses a window that closes before it opens", () => {
    const backwards = { ...planned(), windowTo: new Date("2027-03-01") };
    expect(plannedPlantingSchema.safeParse(backwards).success).toBe(false);
  });
});

describe("plantingToActual", () => {
  it("turns the plan into a planting in one step", () => {
    const result = plantingToActual(planned(), new Date("2027-03-08"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.bedId).toBe(id(1));
      expect(result.draft.plantedOn).toEqual(new Date("2027-03-08"));
      expect(result.draft.status).toBe("growing");
    }
  });

  it("takes the bed supplied at planting time", () => {
    const result = plantingToActual(planned({ bedId: undefined }), AT, id(7));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.bedId).toBe(id(7));
  });

  it("refuses a plan with no bed decided", () => {
    expect(plantingToActual(planned({ bedId: undefined }), AT).ok).toBe(false);
  });

  it("refuses to realise a plan twice", () => {
    expect(plantingToActual(planned({ planStatus: "realised" }), AT).ok).toBe(false);
  });
});

describe("frostDatesFor", () => {
  it("knows Wise County's 8a", () => {
    // docs/property-layout.md flags 8a for confirmation against Fort Worth's
    // 8a/8b — this is the value it records.
    const dates = frostDatesFor("8a", 2027);

    expect(dates?.lastSpringFrost).toEqual(new Date("2027-03-25T00:00:00Z"));
    expect(dates?.firstFallFrost).toEqual(new Date("2027-11-10T00:00:00Z"));
    expect(dates?.growingDays).toBe(230);
  });

  it("says nothing for a zone it does not carry", () => {
    expect(frostDatesFor("3b", 2027)).toBeUndefined();
    expect(frostDatesFor(undefined, 2027)).toBeUndefined();
  });

  it("gates frost warnings to the growing season, per §6", () => {
    const dates = frostDatesFor("8a", 2027);

    expect(isInGrowingSeason(dates, new Date("2027-06-01"))).toBe(true);
    expect(isInGrowingSeason(dates, new Date("2027-01-15"))).toBe(false);
  });

  it("assumes the season is open when the zone is unknown", () => {
    // Warning about frost out of season is noise; missing a frost because the
    // zone was never set is a dead garden.
    expect(isInGrowingSeason(undefined, new Date("2027-01-15"))).toBe(true);
  });

  it("accepts a season plan", () => {
    const plan = { id: id(51), ...base, name: "2027", year: 2027, active: true };
    expect(seasonPlanSchema.safeParse(plan).success).toBe(true);
  });
});
