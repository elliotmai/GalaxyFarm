import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import { gardenJobs } from "../src/domain/jobs.js";
import type { Planting } from "../src/domain/planting.js";
import { frostDatesFor, type PlannedPlanting } from "../src/domain/season-plan.js";

/** What the garden needs doing soon (§5.5): the plan, the seedlings, the picking, the next sowing. */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5J${String(n).padStart(2, "0")}` as Ulid;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const base = { propertyId: id(0), createdAt: day("2027-01-01"), updatedAt: day("2027-01-01") };
const PEPPER = id(50);
const LETTUCE = id(51);
const FACTS: Record<string, object> = {
  [PEPPER]: { daysToMaturity: 70, startIndoorsWeeks: 10, harvestWeeks: 6 },
  [LETTUCE]: { daysToMaturity: 50, successionDays: 14, frostTolerance: "half_hardy" },
};
const factsFor = (varietyId: Ulid) => FACTS[varietyId];
const FROST = frostDatesFor("8a", 2027);

const planned = (over: Partial<PlannedPlanting>): PlannedPlanting => ({
  ...base,
  id: id(1),
  seasonPlanId: id(2),
  varietyId: PEPPER,
  method: "indoor_start",
  windowFrom: day("2027-01-21"),
  windowTo: day("2027-01-28"),
  planStatus: "open",
  ...over,
});

const planting = (over: Partial<Planting>): Planting => ({
  ...base,
  id: id(10),
  varietyId: PEPPER,
  method: "indoor_start",
  status: "started",
  ...over,
});

describe("gardenJobs", () => {
  it("lists a plan window opening in the next fortnight, and not one months off", () => {
    const jobs = gardenJobs({
      planned: [
        planned({}),
        planned({ id: id(3), windowFrom: day("2027-04-01"), windowTo: day("2027-04-08") }),
      ],
      plantings: [],
      factsFor,
      now: day("2027-01-15"),
    });
    expect(jobs.map((job) => job.kind)).toEqual(["start_indoors"]);
    expect(jobs[0]?.overdue).toBe(false);
  });

  it("marks a window that has closed unacted on as overdue, then lets it go", () => {
    const late = gardenJobs({
      planned: [planned({})],
      plantings: [],
      factsFor,
      now: day("2027-02-01"),
    });
    expect(late[0]?.overdue).toBe(true);
    const gone = gardenJobs({
      planned: [planned({})],
      plantings: [],
      factsFor,
      now: day("2027-03-01"),
    });
    expect(gone).toEqual([]);
  });

  it("puts a tray out to harden a week before it is due in the ground", () => {
    const jobs = gardenJobs({
      planned: [],
      plantings: [planting({ indoorStartedOn: day("2027-01-21") })],
      factsFor,
      now: day("2027-03-20"),
    });
    expect(jobs).toEqual([
      expect.objectContaining({
        kind: "harden_off",
        due: day("2027-03-25"),
        until: day("2027-04-01"),
      }),
    ]);
  });

  it("plants out a week after hardening started", () => {
    const [job] = gardenJobs({
      planned: [],
      plantings: [planting({ status: "hardening", hardenedOffOn: day("2027-03-25") })],
      factsFor,
      now: day("2027-03-28"),
    });
    expect(job).toMatchObject({ kind: "plant_out", due: day("2027-04-01") });
  });

  it("says when there is something to pick", () => {
    const [job] = gardenJobs({
      planned: [],
      plantings: [
        planting({
          status: "growing",
          method: "transplant",
          bedId: id(90),
          plantedOn: day("2027-04-01"),
        }),
      ],
      factsFor,
      now: day("2027-06-05"),
    });
    expect(job).toMatchObject({ kind: "pick", due: day("2027-06-10") });
  });

  it("asks for the next sowing of a succession crop, until it would not finish", () => {
    const sown = planting({
      varietyId: LETTUCE,
      method: "direct_sow",
      status: "growing",
      bedId: id(90),
      plantedOn: day("2027-03-01"),
    });
    const [job] = gardenJobs({
      planned: [],
      plantings: [sown],
      factsFor,
      frost: FROST,
      now: day("2027-03-10"),
    });
    expect(job).toMatchObject({ kind: "sow_again", due: day("2027-03-15") });

    // A sowing in late September would not finish before the November frost.
    const late = { ...sown, plantedOn: day("2027-09-20") };
    expect(
      gardenJobs({
        planned: [],
        plantings: [late],
        factsFor,
        frost: FROST,
        now: day("2027-09-30"),
      }),
    ).toEqual([]);
  });
});
