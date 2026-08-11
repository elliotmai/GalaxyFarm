import { describe, expect, it } from "vitest";

import { fromDollars, type PurchaseCandidate, type Ulid } from "@galaxy-farm/core";

import {
  costOfOwnership,
  currentMeter,
  equipmentSchema,
  fuelEfficiency,
  maintenanceDue,
  maintenanceRuleSchema,
  type FuelLog,
  type MaintenanceLog,
  type MaintenanceRule,
  type MeterReading,
} from "../src/domain/equipment.js";
import {
  concerns,
  equipmentCandidateSchema,
  pricePerHour,
  pricePerMile,
  type EquipmentCandidateDetail,
} from "../src/domain/equipment-candidate.js";

/** Equipment (spec §5.6). */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const base = { propertyId: id(0), createdAt: new Date("2026-01-01"), updatedAt: AT };

const TRUCK = id(1);

const rule = (over: Partial<MaintenanceRule> = {}): MaintenanceRule => ({
  id: id(10),
  ...base,
  equipmentId: TRUCK,
  task: "Oil change",
  everyMiles: 5000,
  active: true,
  ...over,
});

const reading = (over: Partial<MeterReading> = {}): MeterReading => ({
  id: id(20),
  ...base,
  equipmentId: TRUCK,
  kind: "miles",
  value: 96_000,
  readOn: new Date("2026-08-01"),
  ...over,
});

describe("equipmentSchema", () => {
  it("accepts a trailer", () => {
    const trailer = {
      id: id(2),
      ...base,
      name: "Gooseneck cattle trailer",
      category: "trailer" as const,
      status: "in_service" as const,
      photoKeys: [],
    };

    expect(equipmentSchema.safeParse(trailer).success).toBe(true);
  });
});

describe("maintenanceRuleSchema", () => {
  it("refuses a rule with no trigger", () => {
    // A rule that never comes due is the same as not existing, except that it
    // looks like coverage on a screen.
    const result = maintenanceRuleSchema.safeParse({ ...rule(), everyMiles: undefined });
    expect(result.success).toBe(false);
  });

  it("accepts hours, miles and months together", () => {
    const combined = { ...rule(), everyHours: 100, everyMonths: 6 };
    expect(maintenanceRuleSchema.safeParse(combined).success).toBe(true);
  });
});

describe("currentMeter", () => {
  it("takes the most recent reading", () => {
    const older = reading({ id: id(21), value: 91_000, readOn: new Date("2026-05-01") });
    expect(currentMeter([older, reading()], TRUCK, "miles")).toBe(96_000);
  });

  it("keeps hours and miles apart", () => {
    const hours = reading({ id: id(22), kind: "hours", value: 410 });
    expect(currentMeter([reading(), hours], TRUCK, "hours")).toBe(410);
  });

  it("says nothing for a machine never read", () => {
    expect(currentMeter([], TRUCK, "miles")).toBeUndefined();
  });
});

describe("maintenanceDue", () => {
  const serviced: MaintenanceLog = {
    id: id(30),
    ...base,
    equipmentId: TRUCK,
    ruleId: id(10),
    task: "Oil change",
    performedOn: new Date("2026-04-01"),
    miles: 92_000,
  };

  it("comes due at the interval past the last service", () => {
    const due = maintenanceDue([rule()], [serviced], [reading()], AT);

    expect(due[0]?.reason).toBe("miles");
    expect(due[0]?.dueAtMiles).toBe(97_000);
    expect(due[0]?.overdue).toBe(false);
  });

  it("is overdue once the meter passes it", () => {
    const far = reading({ id: id(23), value: 98_500 });
    expect(maintenanceDue([rule()], [serviced], [far], AT)[0]?.overdue).toBe(true);
  });

  it("reports whichever trigger comes up first", () => {
    // §5.6 allows any combination, and the first to arrive is what keeps oil
    // in an engine that sits all winter and then runs eighty hours.
    const both = rule({ everyMonths: 3 });
    const due = maintenanceDue([both], [serviced], [reading()], AT);

    expect(due[0]?.reason).toBe("months");
    expect(due[0]?.overdue).toBe(true);
  });

  it("says why rather than only that it is due", () => {
    // "Overdue" with no explanation is a notification people dismiss.
    const due = maintenanceDue([rule({ everyMonths: 3 })], [serviced], [reading()], AT);
    expect(due[0]?.dueAt).toBeDefined();
  });

  it("ignores an inactive rule", () => {
    expect(maintenanceDue([rule({ active: false })], [], [reading()], AT)).toEqual([]);
  });

  it("measures from the first reading when nothing has been serviced yet", () => {
    expect(maintenanceDue([rule()], [], [reading()], AT)[0]?.dueAtMiles).toBe(5000);
  });

  it("skips a meter trigger on a machine with no readings", () => {
    // Otherwise every unread machine would report due at zero.
    expect(maintenanceDue([rule()], [], [], AT)).toEqual([]);
  });
});

describe("costOfOwnership and fuelEfficiency", () => {
  const fuel = (over: Partial<FuelLog> = {}): FuelLog => ({
    id: id(40),
    ...base,
    equipmentId: TRUCK,
    gallons: 22,
    cost: fromDollars(70),
    filledOn: new Date("2026-07-01"),
    miles: 95_000,
    ...over,
  });

  it("adds maintenance and fuel", () => {
    const serviced: MaintenanceLog = {
      id: id(31),
      ...base,
      equipmentId: TRUCK,
      task: "Oil change",
      performedOn: new Date("2026-04-01"),
      cost: fromDollars(95),
    };

    expect(costOfOwnership(TRUCK, [serviced], [fuel()])).toEqual(fromDollars(165));
  });

  it("computes tank to tank, dropping the first fill", () => {
    // The first fill replaced fuel burned before the first reading, so counting
    // it overstates consumption and understates the mileage.
    const second = fuel({ id: id(41), gallons: 20, miles: 95_400 });
    expect(fuelEfficiency([fuel(), second], TRUCK)).toBeCloseTo(20, 6);
  });

  it("says nothing from a single fill", () => {
    expect(fuelEfficiency([fuel()], TRUCK)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- candidates

const candidate: Pick<PurchaseCandidate, "askingPrice" | "additionalCosts"> = {
  askingPrice: fromDollars(34_500),
  additionalCosts: [{ label: "Hauling", amount: fromDollars(900) }],
};

const detail: EquipmentCandidateDetail = {
  candidateId: id(50),
  category: "vehicle",
  make: "Ford",
  model: "F-250",
  year: 2018,
  mileage: 96_000,
  serviceHistoryAvailable: true,
  titleStatus: "clean",
};

describe("pricePerMile and pricePerHour", () => {
  it("divides total acquisition cost, not the sticker price", () => {
    // §5.1: the sticker price "is the one number that never decides anything".
    // A truck two states away with a $900 haul is not the cheap one.
    expect(pricePerMile(candidate, detail)?.cents).toBeCloseTo(3_540_000 / 96_000, 6);
  });

  it("says nothing at zero, because the question does not apply", () => {
    expect(pricePerMile(candidate, { mileage: 0 })).toBeUndefined();
    expect(pricePerHour(candidate, {})).toBeUndefined();
  });

  it("divides by hours for a tractor", () => {
    expect(pricePerHour(candidate, { engineHours: 1200 })?.cents).toBeCloseTo(3_540_000 / 1200, 6);
  });
});

describe("concerns", () => {
  it("names what to ask about before handing over money", () => {
    const rough = concerns({
      ...detail,
      titleStatus: "lien",
      serviceHistoryAvailable: false,
      knownFaults: "Rear main seal weeps",
      condition: "rough",
    });

    expect(rough).toEqual([
      "There is a lien on the title",
      "No service history",
      "Known faults: Rear main seal weeps",
      "Condition listed as rough",
    ]);
  });

  it("says nothing about a clean one", () => {
    expect(concerns(detail)).toEqual([]);
  });

  it("is a list rather than a score", () => {
    // §5.1's comparison view is for a decision made away from the screen; a
    // single number flattens the things somebody needs to weigh themselves.
    expect(Array.isArray(concerns(detail))).toBe(true);
  });
});

describe("equipmentCandidateSchema", () => {
  it("accepts a real listing", () => {
    expect(equipmentCandidateSchema.safeParse(detail).success).toBe(true);
  });
});
