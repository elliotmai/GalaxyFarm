import { describe, expect, it } from "vitest";

import {
  SAFETY_LEVEL_DEFAULTS,
  effectiveSafetyLevel,
  requiresExperiencedHandler,
  safetyLevelSchema,
  suggestedLevelAfterCalving,
} from "../src/value-objects/safety-level.js";
import {
  UnitMismatchError,
  addQuantities,
  quantity,
  scaleQuantity,
  subtractQuantities,
  sumQuantities,
} from "../src/value-objects/quantity.js";
import {
  addMoney,
  compareMoney,
  divideMoney,
  formatMoney,
  fromDollars,
  money,
  multiplyMoney,
  subtractMoney,
  sumMoney,
  toDollars,
} from "../src/value-objects/money.js";
import {
  addCalendarDays,
  addDays,
  asDate,
  close,
  contains,
  dateRange,
  dayKey,
  daysBetween,
  durationDays,
  endOfDay,
  isOpenRange,
  isSameDay,
  overlaps,
  startOfDay,
} from "../src/value-objects/date-range.js";

describe("safety level", () => {
  it("takes the worst of the zone and its occupants", () => {
    // Spec §5.1: moving the bull into a green pen turns it red, everywhere.
    expect(effectiveSafetyLevel(1, [1, 2, 5])).toBe(5);
    expect(effectiveSafetyLevel(3, [1, 2])).toBe(3);
  });

  it("is the zone's own baseline when the pen is empty", () => {
    expect(effectiveSafetyLevel(4, [])).toBe(4);
  });

  it("flags the levels a helper must not approach alone", () => {
    expect(requiresExperiencedHandler(3)).toBe(false);
    expect(requiresExperiencedHandler(4)).toBe(true);
    expect(requiresExperiencedHandler(5)).toBe(true);
  });

  it("suggests an elevated level for a fresh dam without lowering a high one", () => {
    expect(suggestedLevelAfterCalving(1)).toBe(3);
    expect(suggestedLevelAfterCalving(2)).toBe(3);
    expect(suggestedLevelAfterCalving(5)).toBe(5);
  });

  it("labels every level, since the number always renders with its meaning", () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      expect(SAFETY_LEVEL_DEFAULTS[level].label).not.toBe("");
      expect(safetyLevelSchema.safeParse(level).success).toBe(true);
    }
    expect(safetyLevelSchema.safeParse(6).success).toBe(false);
    expect(safetyLevelSchema.safeParse(0).success).toBe(false);
  });
});

describe("quantity", () => {
  it("adds and subtracts within a unit", () => {
    expect(addQuantities(quantity(3, "round_bale"), quantity(2, "round_bale"))).toEqual(
      quantity(5, "round_bale"),
    );
    expect(subtractQuantities(quantity(5, "bag"), quantity(2, "bag"))).toEqual(quantity(3, "bag"));
  });

  it("refuses to add a bale to a bag", () => {
    // The whole reason a quantity is not a bare number.
    expect(() => addQuantities(quantity(1, "round_bale"), quantity(1, "bag"))).toThrow(
      UnitMismatchError,
    );
    expect(() => subtractQuantities(quantity(1, "lb"), quantity(1, "ton"))).toThrow(
      /Cannot combine/,
    );
  });

  it("scales", () => {
    expect(scaleQuantity(quantity(2.5, "lb"), 4)).toEqual(quantity(10, "lb"));
  });

  it("sums a list, including an empty one", () => {
    expect(sumQuantities([quantity(1, "head"), quantity(2, "head")], "head")).toEqual(
      quantity(3, "head"),
    );
    expect(sumQuantities([], "lb")).toEqual(quantity(0, "lb"));
  });
});

describe("money", () => {
  it("stores whole cents and rejects fractions", () => {
    expect(money(1234).cents).toBe(1234);
    expect(() => money(12.5)).toThrow(TypeError);
  });

  it("converts to and from dollars without drift", () => {
    // 0.1 + 0.2 in floats is the reason this type exists.
    const total = addMoney(fromDollars(0.1), fromDollars(0.2));

    expect(total.cents).toBe(30);
    expect(toDollars(total)).toBe(0.3);
  });

  it("adds, subtracts, and sums", () => {
    expect(addMoney(money(100), money(250)).cents).toBe(350);
    expect(subtractMoney(money(100), money(250)).cents).toBe(-150);
    expect(sumMoney([money(1), money(2), money(3)]).cents).toBe(6);
    expect(sumMoney([]).cents).toBe(0);
  });

  it("allows a negative balance, because a credit is a real thing", () => {
    expect(money(-500).cents).toBe(-500);
  });

  it("divides to the nearest cent for per-head allocation", () => {
    expect(divideMoney(money(1000), 3).cents).toBe(333);
    expect(() => divideMoney(money(100), 0)).toThrow(RangeError);
  });

  it("multiplies to the nearest cent", () => {
    expect(multiplyMoney(money(333), 3).cents).toBe(999);
    expect(multiplyMoney(money(100), 1.005).cents).toBe(101);
  });

  it("compares", () => {
    expect(compareMoney(money(100), money(200))).toBeLessThan(0);
    expect(compareMoney(money(200), money(100))).toBeGreaterThan(0);
    expect(compareMoney(money(100), money(100))).toBe(0);
  });

  it("formats for display", () => {
    expect(formatMoney(money(123_456))).toBe("$1,234.56");
  });
});

describe("date range", () => {
  const jan1 = new Date("2026-01-01T00:00:00Z");
  const jan10 = new Date("2026-01-10T00:00:00Z");
  const jan20 = new Date("2026-01-20T00:00:00Z");

  it("rejects an end before its start", () => {
    expect(() => dateRange(jan10, jan1)).toThrow(RangeError);
  });

  it("treats a missing end as still true", () => {
    // The current ZoneAssignment is the open one — this is the normal case.
    expect(isOpenRange(dateRange(jan1))).toBe(true);
    expect(isOpenRange(dateRange(jan1, jan10))).toBe(false);
  });

  it("is half-open: the start is inside, the end is not", () => {
    const range = dateRange(jan1, jan10);

    expect(contains(range, jan1)).toBe(true);
    expect(contains(range, new Date("2026-01-05T00:00:00Z"))).toBe(true);
    expect(contains(range, jan10)).toBe(false);
    expect(contains(range, new Date("2025-12-31T00:00:00Z"))).toBe(false);
  });

  it("an open range contains everything after its start", () => {
    expect(contains(dateRange(jan1), jan20)).toBe(true);
  });

  it("detects overlap", () => {
    expect(overlaps(dateRange(jan1, jan10), dateRange(new Date("2026-01-05"), jan20))).toBe(true);
    expect(overlaps(dateRange(jan1, jan10), dateRange(jan10, jan20))).toBe(false);
    expect(overlaps(dateRange(jan1), dateRange(jan20))).toBe(true);
  });

  it("measures duration, using now for an open range", () => {
    expect(durationDays(dateRange(jan1, jan10), jan20)).toBe(9);
    expect(durationDays(dateRange(jan1), jan10)).toBe(9);
  });

  it("adds days and counts between dates", () => {
    expect(addDays(jan1, 9)).toEqual(jan10);
    expect(daysBetween(jan1, jan10)).toBe(9);
    expect(daysBetween(jan10, jan1)).toBe(-9);
  });

  it("closes an open range once and refuses to do it twice", () => {
    const open = dateRange(jan1);
    const closed = close(open, jan10);

    expect(closed.to).toEqual(jan10);
    expect(() => close(closed, jan20)).toThrow(/already closed/);
  });
});

describe("local days", () => {
  // Built from local parts throughout. A literal like "2026-03-08T00:00:00Z"
  // is a different wall-clock day in half the world, and these are exactly the
  // functions whose job is to answer in the reader's own day.
  const marchEighth = new Date(2026, 2, 8, 13, 45, 30, 250);

  it("brackets the day the person is actually having", () => {
    expect(startOfDay(marchEighth)).toEqual(new Date(2026, 2, 8, 0, 0, 0, 0));
    expect(endOfDay(marchEighth)).toEqual(new Date(2026, 2, 8, 23, 59, 59, 999));
  });

  it("keys and compares by local date", () => {
    expect(dayKey(marchEighth)).toBe("2026-03-08");
    expect(dayKey(new Date(2026, 11, 1, 0, 0, 0))).toBe("2026-12-01");

    expect(isSameDay(marchEighth, endOfDay(marchEighth))).toBe(true);
    expect(isSameDay(marchEighth, addCalendarDays(marchEighth, 1))).toBe(false);
  });

  it("steps a calendar day without drifting off the clock", () => {
    // 8 March 2026 is the US spring-forward. Adding 86,400,000 ms to local
    // midnight lands at 1am on the 9th; adding a calendar day lands on
    // midnight, which is what a loop over a week has to do to visit seven
    // distinct days.
    expect(addCalendarDays(new Date(2026, 2, 8, 0, 0, 0), 1)).toEqual(
      new Date(2026, 2, 9, 0, 0, 0),
    );
    expect(addCalendarDays(marchEighth, -1)).toEqual(new Date(2026, 2, 7, 13, 45, 30, 250));
  });

  it("visits every date exactly once across a year of stepping", () => {
    // The property the chore sheet depends on, and the one millisecond
    // arithmetic breaks twice a year in any zone that observes DST.
    const start = startOfDay(new Date(2026, 0, 1));
    const keys = Array.from({ length: 365 }, (_, offset) => dayKey(addCalendarDays(start, offset)));

    expect(new Set(keys).size).toBe(365);
    expect(keys.at(-1)).toBe("2026-12-31");
  });
});

describe("asDate", () => {
  /**
   * The last line of defence for a date that arrived as something else.
   *
   * Timestamps inside a JSON column came off the wire as strings, and a screen
   * formatting one threw mid-render — which React answers by unmounting the
   * app, not the row. The reviving is fixed; this is what the screens printing
   * those fields use, so a record written by an older build costs a missing
   * date rather than a blank page.
   */
  it("passes a real Date through", () => {
    const at = new Date("2026-05-01T00:00:00.000Z");
    expect(asDate(at)).toBe(at);
  });

  it("reads one that arrived as a string or a number", () => {
    expect(asDate("2026-05-01T00:00:00.000Z")?.getTime()).toBe(Date.parse("2026-05-01"));
    expect(asDate(1_777_593_600_000)?.getTime()).toBe(1_777_593_600_000);
  });

  it("gives nothing back rather than an Invalid Date", () => {
    // NaN compares false against everything and formats as "Invalid Date".
    // Absent is a state every caller already handles.
    expect(asDate("whenever")).toBeUndefined();
    expect(asDate(new Date("whenever"))).toBeUndefined();
    expect(asDate(undefined)).toBeUndefined();
    expect(asDate(null)).toBeUndefined();
    expect(asDate({ date: "2026-05-01" })).toBeUndefined();
  });
});
