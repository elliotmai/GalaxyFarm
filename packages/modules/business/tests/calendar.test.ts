import { describe, expect, it } from "vitest";

import { projectEvents, type Ulid } from "@galaxy-farm/core";

import { businessCalendarEntries } from "../src/domain/calendar.js";
import type { ProgramEnrollment } from "../src/domain/entities.js";
import type { RuleSubject } from "../src/domain/rules.js";

/**
 * The business half of the unified calendar (spec §6, §5.7).
 *
 * §5.7 has the age rules "evaluated at booking and continuously against DOB",
 * and a calendar row is what continuous looks like: the ring at eight months
 * and the departure at ten are both knowable the day a four-month calf
 * arrives. Correcting the DOB when the papers turn up moves all of them.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const bullCalf = (over: Partial<RuleSubject> = {}): RuleSubject => ({
  animalId: id(1),
  ownership: "client",
  dob: new Date("2026-03-01T00:00:00Z"),
  sex: "male",
  weaned: true,
  hasVisibleId: true,
  ...over,
});

const enrollment = (over: Partial<ProgramEnrollment> = {}): ProgramEnrollment => ({
  ...base,
  id: id(2),
  animalId: id(1),
  customerId: id(3),
  halterColor: "#000000",
  startDate: new Date("2026-06-01T00:00:00Z"),
  packages: [],
  active: true,
  ...over,
});

const names = new Map<Ulid, string>([[id(1), "Lot 12"]]);

describe("businessCalendarEntries", () => {
  it("projects the ring and both departure dates a client bull is bound by", () => {
    const entries = businessCalendarEntries({ subjects: [bullCalf()], animalNames: names }, AT);

    expect(entries.map((entry) => entry.kind)).toEqual(["rule_deadline", "rule_deadline"]);
    expect(entries.map((entry) => entry.title)).toEqual([
      "Lot 12 — Bulls ringed by 8 months",
      "Lot 12 — Bulls depart by 10 months",
    ]);
  });

  it("gives one animal's several deadlines ids that do not collide", () => {
    const entries = businessCalendarEntries({ subjects: [bullCalf()] }, AT);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  it("is idempotent and moves every deadline when the DOB is corrected", () => {
    const before = businessCalendarEntries({ subjects: [bullCalf()] }, AT);
    const again = businessCalendarEntries({ subjects: [bullCalf()] }, AT);
    expect(again).toEqual(before);

    const after = businessCalendarEntries(
      { subjects: [bullCalf({ dob: new Date("2026-03-08T00:00:00Z") })] },
      AT,
    );

    expect(after.map((entry) => entry.id)).toEqual(before.map((entry) => entry.id));
    for (const [index, entry] of after.entries()) {
      expect(entry.at.getTime() - (before[index] as { at: Date }).at.getTime()).toBe(
        7 * 86_400_000,
      );
    }
  });

  it("says nothing about your own calves", () => {
    // §5.7 is explicit: your own calves bypass the eligibility gates. A ring
    // deadline on a calf you own would be the rule engine telling you what to
    // do on your own place.
    expect(businessCalendarEntries({ subjects: [bullCalf({ ownership: "own" })] }, AT)).toEqual([]);
  });

  it("projects the drop-off and the estimated pickup", () => {
    const entries = businessCalendarEntries(
      {
        enrollments: [
          enrollment({
            dropOffDate: new Date("2026-06-01T00:00:00Z"),
            estPickupDate: new Date("2026-12-15T00:00:00Z"),
          }),
        ],
        animalNames: names,
      },
      AT,
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["drop_off", "pickup_estimate"]);
    expect(entries[1]?.title).toBe("Lot 12 — pickup (estimated)");
  });

  it("falls back to the target end date when no pickup has been estimated", () => {
    const entries = businessCalendarEntries(
      { enrollments: [enrollment({ targetEndDate: new Date("2026-11-01T00:00:00Z") })] },
      AT,
    );

    expect(entries.map((entry) => entry.at)).toEqual([new Date("2026-11-01T00:00:00Z")]);
  });

  it("merges into the kernel's calendar under the business filter", () => {
    const entries = businessCalendarEntries({ subjects: [bullCalf()] }, AT);
    const autumn = projectEvents(
      { manual: [], projected: entries },
      { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-30T00:00:00Z") },
      ["business"],
    );

    expect(autumn).toHaveLength(1);
    expect(autumn[0]?.title).toContain("ringed by 8 months");
  });
});
