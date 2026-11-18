import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import { growingFor } from "../src/domain/growing.js";
import { planGarden, plantArea, suggestedCount, type PlannerWant } from "../src/domain/planner.js";
import type { FrostDates } from "../src/domain/season-plan.js";

/** Planning the garden from a wish list (§5.5). */

const frostFor = (year: number): FrostDates => ({
  lastSpringFrost: new Date(year, 3, 15),
  firstFallFrost: new Date(year, 9, 15),
  growingDays: 183,
});

const want = (name: string, fields: Partial<PlannerWant> = {}): PlannerWant => ({
  varietyId: `v-${name}` as Ulid,
  name,
  cropName: name,
  family: undefined,
  facts: growingFor(name),
  count: 2,
  ...fields,
});

const bed = (n: number, lengthFt = 8, widthFt = 4) => ({
  id: `bed-${n}` as Ulid,
  name: `Bed ${n}`,
  lengthFt,
  widthFt,
});

describe("planning from a wish list", () => {
  it("says what to do and when, from the frost dates", () => {
    const { rows } = planGarden({
      wants: [want("Tomato", { family: "Solanaceae", count: 4 })],
      beds: [bed(1)],
      history: [],
      frostFor,
      years: [2027],
    });
    const [row] = rows;
    // Started inside seven weeks before the last frost, set out a fortnight after.
    expect(row).toMatchObject({ method: "indoor_start", season: "spring", bedId: "bed-1" });
    expect(row?.step.kind).toBe("start_indoors");
    expect(row?.step.from).toEqual(new Date(2027, 1, 25));
    expect(row?.steps.map((step) => step.kind)).toEqual([
      "start_indoors",
      "harden_off",
      "transplant",
      "harvest",
    ]);
  });

  it("walks a family round the beds over the years", () => {
    const { rows } = planGarden({
      wants: [want("Tomato", { family: "Solanaceae", count: 4 })],
      beds: [bed(1), bed(2), bed(3)],
      history: [],
      frostFor,
      years: [2027, 2028, 2029],
    });
    expect(rows.map((row) => row.bedId)).toEqual(["bed-1", "bed-2", "bed-3"]);
    expect(rows.every((row) => row.notes.length === 0)).toBe(true);
  });

  it("reads what actually grew last year", () => {
    const { rows } = planGarden({
      wants: [want("Pepper", { family: "Solanaceae" })],
      beds: [bed(1), bed(2)],
      history: [{ bedId: "bed-1" as Ulid, family: "Solanaceae", plantedOn: new Date(2026, 4, 1) }],
      frostFor,
      years: [2027],
    });
    expect(rows[0]?.bedId).toBe("bed-2");
  });

  it("says so when the rotation cannot be kept, rather than refusing", () => {
    const { rows } = planGarden({
      wants: [want("Pepper", { family: "Solanaceae" })],
      beds: [bed(1)],
      history: [{ bedId: "bed-1" as Ulid, family: "Solanaceae", plantedOn: new Date(2026, 4, 1) }],
      frostFor,
      years: [2027],
    });
    expect(rows[0]?.bedId).toBe("bed-1");
    expect(rows[0]?.notes[0]).toMatch(/Solanaceae were in Bed 1 within 3 years/);
  });

  it("packs a bed before starting the next, and stops at what fits", () => {
    // 4×4 = 16 sq ft. Four tomatoes at 24" take 16; a fifth does not fit.
    const { rows } = planGarden({
      wants: [want("Tomato", { count: 4 }), want("Pepper", { count: 2 })],
      beds: [bed(1, 4, 4), bed(2, 4, 4)],
      history: [],
      frostFor,
      years: [2027],
    });
    expect(rows.find((row) => row.name === "Tomato")?.bedId).toBe("bed-1");
    expect(rows.find((row) => row.name === "Pepper")?.bedId).toBe("bed-2");
  });

  it("lists a plant with nowhere to go, and how much room it is short", () => {
    const { rows } = planGarden({
      wants: [want("Squash", { count: 4 })],
      beds: [bed(1, 4, 4)],
      history: [],
      frostFor,
      years: [2027],
    });
    expect(rows[0]?.bedId).toBeUndefined();
    expect(rows[0]?.notes[0]).toBe("No bed has room then — needs 20 sq ft more");
  });

  it("keeps apart what does not get on, when there is another bed", () => {
    const { rows } = planGarden({
      wants: [
        want("Onion", { family: "Amaryllidaceae", count: 10 }),
        want("Bean", { family: "Fabaceae", count: 10 }),
      ],
      beds: [bed(1), bed(2)],
      history: [],
      frostFor,
      years: [2027],
    });
    const onion = rows.find((row) => row.name === "Onion");
    const bean = rows.find((row) => row.name === "Bean");
    expect(onion?.bedId).not.toBe(bean?.bedId);
  });

  it("plants again for fall when asked, in room the spring crop has left", () => {
    const { rows } = planGarden({
      wants: [want("Lettuce", { family: "Asteraceae", count: 18, fall: true })],
      beds: [bed(1, 3, 3)],
      history: [],
      frostFor,
      years: [2027],
    });
    expect(rows.map((row) => row.season)).toEqual(["spring", "fall"]);
    expect(rows.every((row) => row.bedId === "bed-1")).toBe(true);
    expect(rows[1]?.step.kind).toBe("fall_sow");
  });

  it("puts garlic in in the fall, to be lifted next year", () => {
    const { rows } = planGarden({
      wants: [want("Garlic", { count: 20 })],
      beds: [bed(1)],
      history: [],
      frostFor,
      years: [2027],
    });
    expect(rows[0]?.season).toBe("fall");
    expect(rows[0]?.step.kind).toBe("fall_plant");
    expect(rows[0]?.inGround.to.getFullYear()).toBe(2028);
  });

  it("says what it cannot schedule instead of guessing", () => {
    const { rows, unscheduled } = planGarden({
      wants: [want("Moonflower", { facts: undefined })],
      beds: [bed(1)],
      history: [],
      frostFor,
      years: [2027],
    });
    expect(rows).toEqual([]);
    expect(unscheduled[0]?.name).toBe("Moonflower");
  });
});

describe("how many", () => {
  it("starts from about eight square feet of it", () => {
    expect(suggestedCount(growingFor("Tomato"))).toBe(2);
    expect(suggestedCount(growingFor("Lettuce"))).toBe(18);
    expect(suggestedCount(growingFor("Carrot"))).toBe(24);
    expect(plantArea(4, 24)).toBe(16);
  });
});
