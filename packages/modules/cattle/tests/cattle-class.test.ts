import { describe, expect, it } from "vitest";

import type { Animal } from "@galaxy-farm/core";

import {
  CALF_MAX_DAYS,
  cattleClass,
  classCounts,
  unclassified,
} from "../src/domain/cattle-class.js";

/**
 * Cows, bulls, steers and calves (spec §5.2).
 *
 * Sex alone does not answer it — a bull calf and a herd bull are both `male`,
 * and counting them together gives a bull number that is nonsense on a place
 * that keeps one. Age alone does not either.
 */

const TODAY = new Date("2026-08-14T12:00:00Z");

const daysAgo = (days: number): Date => new Date(TODAY.getTime() - days * 86_400_000);

const beast = (sex: Animal["sex"], bornDaysAgo?: number): Pick<Animal, "sex" | "dob"> => ({
  sex,
  ...(bornDaysAgo === undefined ? {} : { dob: daysAgo(bornDaysAgo) }),
});

describe("what kind of animal this is", () => {
  it("calls a grown female a cow and a grown intact male a bull", () => {
    expect(cattleClass(beast("female", 900), TODAY)).toBe("cow");
    expect(cattleClass(beast("male", 900), TODAY)).toBe("bull");
  });

  it("calls anything under a year a calf, either sex", () => {
    // Heifer calves and bull calves are calves until they are yearlings,
    // which is how the herd is spoken about here.
    expect(cattleClass(beast("female", 120), TODAY)).toBe("calf");
    expect(cattleClass(beast("male", 120), TODAY)).toBe("calf");
  });

  it("turns a calf into a cow or a bull on its first birthday", () => {
    expect(cattleClass(beast("female", CALF_MAX_DAYS - 1), TODAY)).toBe("calf");
    expect(cattleClass(beast("female", CALF_MAX_DAYS), TODAY)).toBe("cow");
    expect(cattleClass(beast("male", CALF_MAX_DAYS), TODAY)).toBe("bull");
  });

  it("counts a steer as a steer from the day he is cut, not from a year old", () => {
    // Banding is a decision about what the animal is *for*: a different pen, a
    // different ration, a different sale. A six-month-old steer filed under
    // calves disappears from the number that matters most about him.
    expect(cattleClass(beast("steer", 60), TODAY)).toBe("steer");
    expect(cattleClass(beast("steer", 900), TODAY)).toBe("steer");
  });

  it("reads a missing birthday as grown rather than as a calf", () => {
    // It has to read as something. An animal with no date is far likelier one
    // that came onto the place already grown than one born here — calves born
    // here arrive through a calving record, which carries the date. The other
    // way round puts every bought cow in the calf count.
    expect(cattleClass(beast("female"), TODAY)).toBe("cow");
    expect(cattleClass(beast("male"), TODAY)).toBe("bull");
  });

  it("refuses to guess when nobody recorded a sex", () => {
    expect(cattleClass(beast("unknown", 900), TODAY)).toBeUndefined();
  });
});

describe("the herd split four ways", () => {
  const herd = [
    beast("female", 1200),
    beast("female", 900),
    beast("male", 1500),
    beast("steer", 200),
    beast("female", 90),
    beast("male", 90),
    beast("unknown", 400),
  ];

  it("counts each class once", () => {
    const counts = classCounts(herd, TODAY);
    const of = (name: string) => counts.find((entry) => entry.cattleClass === name)?.count;

    expect(of("cow")).toBe(2);
    expect(of("bull")).toBe(1);
    expect(of("steer")).toBe(1);
    expect(of("calf")).toBe(2);
  });

  it("keeps the order fixed, so it is not re-read every morning", () => {
    // A row of numbers that reorders itself as calves are born has to be read
    // word by word every time.
    expect(classCounts(herd, TODAY).map((entry) => entry.cattleClass)).toEqual([
      "cow",
      "bull",
      "steer",
      "calf",
    ]);
  });

  it("keeps a class that is empty", () => {
    // "Bulls 0" is worth seeing on a place that breeds by AI. A class that
    // vanishes when it empties looks like one the app forgot about.
    const noBulls = classCounts([beast("female", 900)], TODAY);

    expect(noBulls.find((entry) => entry.cattleClass === "bull")?.count).toBe(0);
  });

  it("counts the ones it cannot place rather than hiding them", () => {
    // An animal missing from every group is one nobody will go and fix.
    expect(unclassified(herd, TODAY)).toBe(1);
  });

  it("adds up to the herd, less the unclassified", () => {
    const total = classCounts(herd, TODAY).reduce((sum, entry) => sum + entry.count, 0);

    expect(total + unclassified(herd, TODAY)).toBe(herd.length);
  });
});
