import { describe, expect, it } from "vitest";

import { projectEvents, type Ulid } from "@galaxy-farm/core";

import { equipmentCalendarEntries } from "../src/domain/calendar.js";
import type {
  Equipment,
  MaintenanceLog,
  MaintenanceRule,
  MeterReading,
} from "../src/domain/equipment.js";

/**
 * The fleet's half of the unified calendar (spec §6, §5.6).
 *
 * §6 asks for "maintenance due (hours/miles/date)" and only the last of those
 * is a date. The tests below pin down what that means on a calendar: a months
 * rule lands on its date, a meter rule lands on the reading that carried it
 * past its interval, and a meter rule that has not got there yet lands
 * nowhere — because a row placed at "now" would move every time the page
 * redrew.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-08-11T12:00:00Z");
const base = { propertyId: id(0), createdAt: AT, updatedAt: AT };

const tractor = (over: Partial<Equipment> = {}): Equipment => ({
  ...base,
  id: id(1),
  name: "Kubota M6",
  category: "vehicle",
  status: "in_service",
  photoKeys: [],
  ...over,
});

const rule = (over: Partial<MaintenanceRule> = {}): MaintenanceRule => ({
  ...base,
  id: id(2),
  equipmentId: id(1),
  task: "Oil and filter",
  everyMonths: 6,
  active: true,
  ...over,
});

const log = (over: Partial<MaintenanceLog> = {}): MaintenanceLog => ({
  ...base,
  id: id(3),
  equipmentId: id(1),
  ruleId: id(2),
  task: "Oil and filter",
  performedOn: new Date("2026-03-01T00:00:00Z"),
  ...over,
});

const reading = (over: Partial<MeterReading> = {}): MeterReading => ({
  ...base,
  id: id(4),
  equipmentId: id(1),
  kind: "hours",
  value: 260,
  readOn: new Date("2026-08-05T00:00:00Z"),
  ...over,
});

describe("equipmentCalendarEntries", () => {
  it("dates a months rule from the last service", () => {
    const entries = equipmentCalendarEntries({
      equipment: [tractor()],
      rules: [rule()],
      logs: [log()],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Kubota M6 — Oil and filter");
    // 1 March plus six 30.4375-day months, rounded — 183 days.
    expect(entries[0]?.at).toEqual(new Date("2026-08-31T00:00:00Z"));
  });

  it("is idempotent and moves the row when the service date is corrected", () => {
    const before = equipmentCalendarEntries({ rules: [rule()], logs: [log()] });
    expect(equipmentCalendarEntries({ rules: [rule()], logs: [log()] })).toEqual(before);

    const after = equipmentCalendarEntries({
      rules: [rule()],
      logs: [log({ performedOn: new Date("2026-03-08T00:00:00Z") })],
    });

    expect(after[0]?.id).toBe(before[0]?.id);
    expect((after[0] as { at: Date }).at.getTime() - (before[0] as { at: Date }).at.getTime()).toBe(
      7 * 86_400_000,
    );
  });

  it("puts an overdue meter rule on the day the meter said so", () => {
    const entries = equipmentCalendarEntries({
      equipment: [tractor()],
      rules: [rule({ everyMonths: undefined, everyHours: 250 })],
      logs: [],
      readings: [reading()],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.at).toEqual(new Date("2026-08-05T00:00:00Z"));
    expect(entries[0]?.detail).toBe("every 250 hours");
  });

  it("leaves a meter rule that has not come due off the calendar", () => {
    const entries = equipmentCalendarEntries({
      rules: [rule({ everyMonths: undefined, everyHours: 250 })],
      readings: [reading({ value: 180 })],
    });

    expect(entries).toEqual([]);
  });

  it("prefers the months date for a rule that has both triggers", () => {
    // The date is the trigger that genuinely names a day. Reporting the hours
    // one would leave the month it is due in unreachable from the calendar.
    const entries = equipmentCalendarEntries({
      rules: [rule({ everyHours: 100 })],
      logs: [log()],
      readings: [reading()],
    });

    expect(entries[0]?.at).toEqual(new Date("2026-08-31T00:00:00Z"));
    expect(entries[0]?.detail).toBe("every 100 hours · every 6 months");
  });

  it("stops asking for oil once a machine is sold", () => {
    const entries = equipmentCalendarEntries({
      equipment: [tractor({ status: "sold" })],
      rules: [rule()],
      logs: [log()],
    });

    expect(entries).toEqual([]);
  });

  it("ignores a rule somebody has switched off", () => {
    expect(equipmentCalendarEntries({ rules: [rule({ active: false })], logs: [log()] })).toEqual(
      [],
    );
  });

  it("merges into the kernel's calendar under the equipment filter", () => {
    const entries = equipmentCalendarEntries({ rules: [rule()], logs: [log()] });
    const august = projectEvents(
      { manual: [], projected: entries },
      { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z") },
      ["equipment"],
    );

    expect(august).toHaveLength(1);
  });
});
