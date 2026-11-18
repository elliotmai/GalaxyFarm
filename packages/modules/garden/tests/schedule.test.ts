import { describe, expect, it } from "vitest";

import { clashesAmong, companionsOf, companionship } from "../src/domain/companions.js";
import { growingFor } from "../src/domain/growing.js";
import { frostDatesFor } from "../src/domain/season-plan.js";
import {
  areaNeeded,
  bedFill,
  harvestWindow,
  latestSowing,
  plantingSchedule,
  plantingWindow,
  plantsThatFit,
  transplantDue,
  usualStart,
} from "../src/domain/schedule.js";

/**
 * When to do what (§5.5, decision 50): every planting date is an offset from
 * the farm's frost dates, and a mistake here is a tray of peppers started a
 * month late or tomatoes set out into a frost.
 */

// Zone 8a: last frost March 25, first frost November 10.
const FROST = frostDatesFor("8a", 2027)!;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("plantingSchedule", () => {
  it("starts peppers inside nine weeks before the last frost and sets them out a fortnight after", () => {
    const schedule = plantingSchedule(growingFor("Pepper"), FROST, "indoor_start");
    const kinds = schedule.map((milestone) => milestone.kind);
    expect(kinds).toEqual(["start_indoors", "harden_off", "transplant", "harvest"]);

    const at = (kind: string) => schedule.find((milestone) => milestone.kind === kind)!;
    expect(at("start_indoors").from).toEqual(day("2027-01-21"));
    // A week of hardening off, ending the day before it goes in.
    expect(at("harden_off").from).toEqual(day("2027-04-01"));
    expect(at("harden_off").to).toEqual(day("2027-04-07"));
    expect(at("transplant").from).toEqual(day("2027-04-08"));
    // 70 days from transplant, picking for ten weeks.
    expect(at("harvest").from).toEqual(day("2027-06-17"));
    expect(at("harvest").to).toEqual(day("2027-08-26"));
  });

  it("skips the indoor start for a bought seedling, and keeps the hardening off", () => {
    const kinds = plantingSchedule(growingFor("Tomato"), FROST, "transplant").map((m) => m.kind);
    expect(kinds).not.toContain("start_indoors");
    expect(kinds).toEqual(expect.arrayContaining(["harden_off", "transplant", "harvest"]));
  });

  it("sows peas six weeks before the last frost, straight into the ground", () => {
    const sow = plantingSchedule(growingFor("Pea"), FROST, "direct_sow").find(
      (m) => m.kind === "sow",
    )!;
    expect(sow.from).toEqual(day("2027-02-11"));
  });

  it("keeps a succession crop's sowing window open until it would not finish", () => {
    const beans = growingFor("Bean")!;
    const sow = plantingSchedule(beans, FROST, "direct_sow").find((m) => m.kind === "sow")!;
    expect(sow.to).toEqual(latestSowing(beans, FROST));
  });

  it("offers a fall sowing for a hardy cool-season crop, and none for a tender one", () => {
    expect(plantingSchedule(growingFor("Kale"), FROST).map((m) => m.kind)).toContain("fall_sow");
    expect(plantingSchedule(growingFor("Tomato"), FROST).map((m) => m.kind)).not.toContain(
      "fall_sow",
    );
  });

  it("plants garlic in the fall, a month before the first frost", () => {
    const fall = plantingSchedule(growingFor("Garlic"), FROST).find(
      (m) => m.kind === "fall_plant",
    )!;
    expect(fall.from).toEqual(day("2027-10-06"));
    expect(fall.to).toEqual(day("2027-10-20"));
  });

  it("says nothing it cannot work out, rather than inventing a date", () => {
    expect(plantingSchedule(undefined, FROST)).toEqual([]);
    expect(plantingSchedule(growingFor("Tomato"), undefined)).toEqual([]);
    expect(plantingSchedule({ daysToMaturity: 60 }, FROST)).toEqual([]);
  });

  it("starts a crop the way it is usually started", () => {
    expect(usualStart(growingFor("Tomato")!)).toBe("indoor_start");
    expect(usualStart(growingFor("Carrot")!)).toBe("direct_sow");
  });

  it("gives a plan entry the window for its first job", () => {
    expect(plantingWindow(growingFor("Pepper"), FROST, "indoor_start")?.kind).toBe("start_indoors");
    expect(plantingWindow(growingFor("Pea"), FROST, "direct_sow")?.kind).toBe("sow");
    expect(plantingWindow(growingFor("Garlic"), FROST, "direct_sow")?.kind).toBe("fall_plant");
  });
});

describe("latestSowing", () => {
  it("leaves a tender crop an extra fortnight to finish before the frost", () => {
    // Beans, 55 days: Nov 10 − (55 + 14 short-day + 14 tender) days.
    expect(latestSowing(growingFor("Bean")!, FROST)).toEqual(day("2027-08-19"));
    // Lettuce, 50 days, half-hardy: Nov 10 − (50 + 14).
    expect(latestSowing(growingFor("Lettuce")!, FROST)).toEqual(day("2027-09-07"));
  });
});

describe("a planting's own dates", () => {
  it("gives a harvest window from when it went in", () => {
    expect(harvestWindow(day("2027-04-08"), { daysToMaturity: 70, harvestWeeks: 4 })).toEqual({
      from: day("2027-06-17"),
      to: day("2027-07-15"),
    });
    expect(harvestWindow(undefined, { daysToMaturity: 70 })).toBeUndefined();
  });

  it("says when a tray started indoors is due to harden off and go out", () => {
    expect(transplantDue(day("2027-01-21"), growingFor("Pepper"))).toEqual({
      hardenFrom: day("2027-03-18"),
      plantOut: day("2027-03-25"),
    });
  });
});

describe("space", () => {
  it("counts how many plants fit in a bed at a spacing", () => {
    // A 4 × 8 ft bed at 12": 4 across, 8 along.
    expect(plantsThatFit({ lengthFt: 8, widthFt: 4 }, 12)).toBe(32);
    // Tomatoes at 24": two across, four along.
    expect(plantsThatFit({ lengthFt: 8, widthFt: 4 }, 24)).toBe(8);
    expect(plantsThatFit({ lengthFt: 8 }, 12)).toBeUndefined();
  });

  it("says how full a bed is with what is in it", () => {
    const bed = { lengthFt: 8, widthFt: 4 };
    expect(
      bedFill(bed, [
        { quantity: 4, spacingInches: 24 },
        { quantity: 16, spacingInches: 12 },
      ]),
    ).toBeCloseTo(1, 6);
    expect(areaNeeded(4, 24)).toBe(16);
  });
});

describe("companions", () => {
  it("knows tomatoes and basil get on, and tomatoes and fennel do not", () => {
    expect(companionship("Tomato", "Basil")?.kind).toBe("good");
    expect(companionship("Basil", "Cherokee Purple tomato")?.kind).toBe("good");
    expect(companionship("Tomato", "Fennel")).toMatchObject({ kind: "bad" });
  });

  it("keeps every onion away from every bean, by family", () => {
    expect(companionship("Garlic", "Bean")?.kind).toBe("bad");
    expect(companionship("Pea", "Leek")?.kind).toBe("bad");
  });

  it("says nothing about a pair it knows nothing about, or a crop beside itself", () => {
    expect(companionship("Okra", "Rhubarb")).toBeUndefined();
    expect(companionship("Tomato", "tomato")).toBeUndefined();
  });

  it("lists a crop's friends and foes", () => {
    const tomato = companionsOf("Tomato");
    expect(tomato.good.map((pairing) => pairing.with)).toContain("Basil");
    expect(tomato.bad.map((pairing) => pairing.with)).toContain("Potato");
  });

  it("finds each clash in a bed once", () => {
    expect(clashesAmong(["Tomato", "Basil", "Fennel", "Potato"])).toEqual([
      expect.objectContaining({ a: "Tomato", b: "Fennel" }),
      expect.objectContaining({ a: "Tomato", b: "Potato" }),
    ]);
  });
});
