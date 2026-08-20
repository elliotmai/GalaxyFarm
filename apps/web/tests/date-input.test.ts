import { describe, expect, it } from "vitest";

import { fromDateInput, todayInput, toDateInput } from "../lib/date-input.js";

/**
 * The day typed is the day stored (spec §4.2).
 *
 * Asserted on the *local* parts rather than against a fixed instant, because
 * the answer depends on where the runner is and the whole point is that it
 * does not matter: whatever the zone, `2026-02-14` is the 14th at midday, and
 * the 14th is what `toLocaleDateString` will say.
 */

describe("fromDateInput", () => {
  it("reads a field as midday local on the day it names", () => {
    const bred = fromDateInput("2026-02-14") as Date;

    expect(bred.getFullYear()).toBe(2026);
    expect(bred.getMonth()).toBe(1);
    expect(bred.getDate()).toBe(14);
    // Midday, so the day survives both daylight-saving changes and every zone.
    expect(bred.getHours()).toBe(12);
  });

  it("is the day the app will show — which a bare new Date is not", () => {
    // The reported bug, as an assertion. `new Date("2026-02-14")` is midnight
    // UTC; anywhere west of Greenwich that renders as the 13th.
    const bred = fromDateInput("2026-02-14") as Date;
    expect(bred.toLocaleDateString("en-GB")).toBe("14/02/2026");
  });

  it("has nothing to say about an empty or broken field", () => {
    expect(fromDateInput("")).toBeUndefined();
    expect(fromDateInput("   ")).toBeUndefined();
    // An Invalid Date would sail on into every projection downstream and come
    // out as a blank cell rather than as an error.
    expect(fromDateInput("not a date")).toBeUndefined();
  });
});

describe("toDateInput", () => {
  it("round-trips a day through the field and back", () => {
    expect(toDateInput(fromDateInput("2026-02-14"))).toBe("2026-02-14");
    expect(toDateInput(fromDateInput("2026-12-31"))).toBe("2026-12-31");
    expect(toDateInput(fromDateInput("2027-01-01"))).toBe("2027-01-01");
  });

  it("uses the local day, not the UTC one", () => {
    // Late evening local on the 14th is already the 15th in UTC east of here
    // and the 14th is still the answer: `toISOString().slice(0, 10)` is what
    // gets this wrong in the opposite direction.
    const lateEvening = new Date(2026, 1, 14, 23, 30);
    expect(toDateInput(lateEvening)).toBe("2026-02-14");
  });

  it("says nothing about nothing", () => {
    expect(toDateInput(undefined)).toBe("");
    expect(toDateInput(new Date("nonsense"))).toBe("");
  });
});

describe("todayInput", () => {
  it("opens a field on the day it is, locally", () => {
    const at = new Date(2026, 7, 20, 22, 15);
    expect(todayInput(at)).toBe("2026-08-20");
  });
});
