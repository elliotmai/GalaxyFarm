import { describe, expect, it } from "vitest";

import { fromDollars, type Ulid } from "@galaxy-farm/core";

import {
  BOARDING_RULES,
  evaluateRules,
  isEligibleForDropOff,
  ruleById,
  ruleDeadlines,
  type RuleSubject,
} from "../src/domain/rules.js";
import {
  DEFAULT_HALTER_COLOR,
  boardDays,
  boardingAgreementSchema,
  bookingRequestSchema,
  invoiceSchema,
  invoiceTotal,
  milestoneStateOf,
  programEnrollmentSchema,
  signedSnapshotSchema,
  type Invoice,
  type TrainingLog,
} from "../src/domain/entities.js";
import { daySheet, daySheetFor, formatSlotTime } from "../src/domain/schedule.js";

/**
 * The business scaffold (spec §5.7).
 *
 * The rules are the part with teeth, and the exemption is as important as the
 * rules themselves: §5.7 says client enrollments only, and a rule engine that
 * stopped you weaning your own calf on your own schedule would be worse than
 * none.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const subject = (over: Partial<RuleSubject> = {}): RuleSubject => ({
  animalId: id(1),
  ownership: "client",
  dob: new Date("2026-04-01"),
  sex: "male",
  weaned: true,
  hasVisibleId: true,
  ...over,
});

describe("BOARDING_RULES", () => {
  it("carries every rule from the §5.7 table", () => {
    expect(BOARDING_RULES).toHaveLength(9);
  });

  it("gives each one a distinct id", () => {
    const ids = BOARDING_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("throws rather than returning undefined for an unknown id", () => {
    // An undefined rule silently disables a gate.
    expect(() => ruleById("nope" as never)).toThrow(/No boarding rule/);
  });
});

describe("evaluateRules", () => {
  it("passes a weaned, tagged, four-month-old calf", () => {
    expect(evaluateRules(subject(), AT)).toEqual([]);
    expect(isEligibleForDropOff(subject(), AT)).toBe(true);
  });

  it("blocks an unweaned calf", () => {
    const violations = evaluateRules(subject({ weaned: false }), AT);
    expect(violations[0]?.rule.id).toBe("weaned-at-drop-off");
    expect(violations[0]?.blocking).toBe(true);
  });

  it("blocks a calf with no visible ID", () => {
    expect(evaluateRules(subject({ hasVisibleId: false }), AT)[0]?.rule.id).toBe("visible-id");
  });

  it("blocks a calf already past six months, and says how old it is", () => {
    const violations = evaluateRules(subject({ dob: new Date("2025-11-01") }), AT);
    expect(violations[0]?.message).toMatch(/9 months old/);
  });

  it("blocks a calf with no date of birth rather than passing it", () => {
    // Silently passing an animal whose age is unknown is how an over-age one
    // arrives.
    const violations = evaluateRules(subject({ dob: undefined }), AT);
    expect(violations.some((violation) => violation.blocking)).toBe(true);
  });

  it("exempts your own calves entirely", () => {
    // §5.7 is explicit. Not "no violations found" — a deliberate skip.
    const mine = subject({ ownership: "own", weaned: false, hasVisibleId: false, dob: undefined });
    expect(evaluateRules(mine, AT)).toEqual([]);
    expect(isEligibleForDropOff(mine, AT)).toBe(true);
  });
});

describe("ruleDeadlines", () => {
  it("projects ringing and departure from the date of birth", () => {
    // A calf that arrives at four months is ringed at eight and gone at ten,
    // and both dates are knowable the day it arrives.
    const deadlines = ruleDeadlines(subject(), AT);

    expect(deadlines.map((deadline) => deadline.rule.id)).toEqual([
      "bull-ringed-by-eight-months",
      "bull-departs-by-ten-months",
    ]);
  });

  it("gives heifers and steers the twelve-month departure instead", () => {
    const heifer = ruleDeadlines(subject({ sex: "female" }), AT);
    expect(heifer.map((deadline) => deadline.rule.id)).toEqual(["depart-by-twelve-months"]);
  });

  it("marks a passed deadline overdue", () => {
    const late = ruleDeadlines(subject({ dob: new Date("2025-06-01") }), AT);
    expect(late.every((deadline) => deadline.overdue)).toBe(true);
  });

  it("knows a bull that has already been ringed", () => {
    const ringed = ruleDeadlines(subject({ ringed: true }), AT);
    expect(ringed.find((d) => d.rule.id === "bull-ringed-by-eight-months")?.satisfied).toBe(true);
  });

  it("projects nothing for your own animals", () => {
    expect(ruleDeadlines(subject({ ownership: "own" }), AT)).toEqual([]);
  });

  it("projects nothing without a date of birth", () => {
    expect(ruleDeadlines(subject({ dob: undefined }), AT)).toEqual([]);
  });
});

// ---------------------------------------------------------------- entities

describe("bookingRequestSchema", () => {
  const request = {
    id: id(10),
    ...base,
    customerName: "A customer",
    customerEmail: "someone@example.invalid",
    calfSex: "steer" as const,
    weaned: true,
    hasVisibleId: true,
    requestedDropOff: new Date("2026-09-01"),
    packages: ["halter_breaking" as const],
    status: "requested" as const,
  };

  it("accepts a request", () => {
    expect(bookingRequestSchema.safeParse(request).success).toBe(true);
  });

  it("refuses a decline with no reason", () => {
    // One the customer cannot act on, and one nobody can explain a year later.
    const declined = { ...request, status: "declined" as const };
    expect(bookingRequestSchema.safeParse(declined).success).toBe(false);
  });
});

describe("programEnrollmentSchema", () => {
  const enrollment = {
    id: id(20),
    ...base,
    animalId: id(1),
    halterColor: DEFAULT_HALTER_COLOR,
    startDate: new Date("2026-09-01"),
    packages: [],
    active: true,
  };

  it("accepts an enrollment with no customer, which is your own calf", () => {
    // §12 decision 11: the programme is decoupled from ownership.
    expect(programEnrollmentSchema.safeParse(enrollment).success).toBe(true);
  });

  it("defaults the halter colour to black", () => {
    // §12 decision 15.
    expect(DEFAULT_HALTER_COLOR).toBe("#000000");
  });

  it("refuses an agreement with no customer behind it", () => {
    const orphan = { ...enrollment, agreementId: id(30) };
    expect(programEnrollmentSchema.safeParse(orphan).success).toBe(false);
  });

  it("refuses a halter colour that is not a colour", () => {
    expect(programEnrollmentSchema.safeParse({ ...enrollment, halterColor: "black" }).success).toBe(
      false,
    );
  });
});

describe("boardingAgreementSchema", () => {
  it("refuses an undocumented termination", () => {
    // §5.7's behaviour clause is "a manual action with documented incident log".
    const agreement = {
      id: id(30),
      ...base,
      customerId: id(40),
      dailyBoardRate: fromDollars(12),
      packages: [],
      startDate: new Date("2026-09-01"),
      status: "terminated" as const,
    };

    expect(boardingAgreementSchema.safeParse(agreement).success).toBe(false);
  });
});

describe("milestoneStateOf", () => {
  const log = (over: Partial<TrainingLog> = {}): TrainingLog => ({
    id: id(50),
    ...base,
    enrollmentId: id(20),
    loggedOn: new Date("2026-09-10"),
    activity: "Halter work",
    milestonesAchieved: ["haltered"],
    visibleToOwner: true,
    ...over,
  });

  it("keeps the first date a milestone was reached", () => {
    // Not the most recent mention: "leads" was achieved the day it was
    // achieved, and a later log noting it again does not move that.
    const later = log({ id: id(51), loggedOn: new Date("2026-10-01") });
    expect(milestoneStateOf([later, log()], id(20)).get("haltered")).toEqual(
      new Date("2026-09-10"),
    );
  });

  it("ignores another calf's logs", () => {
    expect(milestoneStateOf([log({ enrollmentId: id(99) })], id(20)).size).toBe(0);
  });
});

describe("invoices", () => {
  const invoice: Invoice = {
    id: id(60),
    ...base,
    customerId: id(40),
    issuedOn: new Date("2027-01-31"),
    status: "draft",
    lines: [
      { description: "Board", quantity: 31, unitAmount: fromDollars(12), kind: "board" },
      { description: "Feed", quantity: 1, unitAmount: fromDollars(87.5), kind: "feed" },
    ],
  };

  it("totals the lines", () => {
    expect(invoiceTotal(invoice)).toEqual(fromDollars(459.5));
  });

  it("refuses a void with no reason", () => {
    // §4.5 governs voiding the same way it governs a delete: irreversible, and
    // it has to say why.
    expect(invoiceSchema.safeParse({ ...invoice, status: "void" }).success).toBe(false);
  });

  it("counts board days between drop-off and pickup", () => {
    expect(boardDays(new Date("2026-09-01"), new Date("2026-10-02"))).toBe(31);
  });

  it("never counts negative board days", () => {
    expect(boardDays(new Date("2026-10-02"), new Date("2026-09-01"))).toBe(0);
  });
});

describe("signedSnapshotSchema", () => {
  it("stores the business name as it read at signing", () => {
    // §5.1's one deliberate exception to BrandingConfig: that is what the
    // person actually agreed to.
    const snapshot = {
      id: id(70),
      ...base,
      liabilityFormId: id(71),
      formVersion: 2,
      customerId: id(40),
      businessNameAtSigning: "Flying Double M Show Cattle",
      signature: { typedName: "A Customer", signedAt: AT },
    };

    expect(signedSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });
});

// ---------------------------------------------------------------- schedule

describe("daySheetFor", () => {
  const template = {
    slots: [
      { activity: "morning_chores" as const, atMinutes: 6 * 60 },
      { activity: "rinse" as const, atMinutes: 10 * 60 },
      { activity: "evening_chores" as const, atMinutes: 18 * 60 },
    ],
  };

  it("orders the day by time", () => {
    expect(daySheetFor(template, []).map((slot) => slot.atMinutes)).toEqual([360, 600, 1080]);
  });

  it("adds the slots a package implies", () => {
    // Hair growing adds the afternoon rinse and the blow-out. Adding them by
    // hand is how a coat gets lost in July.
    const withHair = daySheetFor(template, ["hair_growing"]);

    expect(withHair.map((slot) => slot.activity)).toEqual([
      "morning_chores",
      "rinse",
      "rinse",
      "blow_dry",
      "evening_chores",
    ]);
  });

  it("lets a per-calf override replace the day outright", () => {
    // "This one is on a different routine" means a different routine.
    const override = { slots: [{ activity: "training" as const, atMinutes: 9 * 60 }] };
    expect(daySheetFor(template, ["hair_growing"], override).map((s) => s.activity)).toEqual([
      "training",
    ]);
  });

  it("ignores a package with no slots of its own", () => {
    expect(daySheetFor(template, ["showing_service"])).toHaveLength(3);
  });
});

describe("daySheet", () => {
  const template = { slots: [{ activity: "rinse" as const, atMinutes: 600 }] };

  it("gives every enrolled calf a row, even an empty one", () => {
    // A missing row reads as "not in the programme" rather than "nothing on".
    const rows = daySheet({ slots: [] }, [
      { id: id(20), packages: [] },
      { id: id(21), packages: ["hair_growing"] },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.slots).toEqual([]);
    expect(rows[1]?.slots).toHaveLength(2);
  });

  it("builds §4.4's calf by activity grid", () => {
    const rows = daySheet(template, [{ id: id(20), packages: [] }]);
    expect(rows[0]?.slots[0]?.activity).toBe("rinse");
  });
});

describe("formatSlotTime", () => {
  it("reads as a clock time", () => {
    expect(formatSlotTime(6 * 60 + 30)).toBe("06:30");
    expect(formatSlotTime(0)).toBe("00:00");
  });
});
