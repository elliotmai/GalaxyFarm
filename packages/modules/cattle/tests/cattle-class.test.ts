import { describe, expect, it } from "vitest";

import type { Animal } from "@galaxy-farm/core";

import {
  CALF_MAX_DAYS,
  cattleClass,
  classCounts,
  damsThatHaveCalved,
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
  it("calls a grown intact male a bull", () => {
    expect(cattleClass(beast("male", 900), TODAY)).toBe("bull");
  });

  it("separates a heifer from a cow by what she has done, not her age", () => {
    // A four-year-old who has never calved is still a heifer; a two-year-old
    // who has raised one is a cow. It is the distinction that decides whether
    // she is on a breeding list, a replacement list or a cull list.
    expect(cattleClass(beast("female", 1500), TODAY)).toBe("heifer");
    expect(cattleClass(beast("female", 1500), TODAY, { hasCalved: true })).toBe("cow");
  });

  it("reads a female with nothing on file as a heifer", () => {
    // The honest default: a female with no calving recorded is far likelier
    // never to have calved than to have calved without anybody writing it down.
    expect(cattleClass(beast("female", 900), TODAY, {})).toBe("heifer");
  });

  it("calls a young female with a calf at side a cow, not a calf", () => {
    // A bought-in two-year-old with a calf at side is not a heifer whatever
    // her birthday says — and without this she would land in the calf bucket
    // if she were young enough, which is the one plainly wrong reading.
    expect(cattleClass(beast("female", 300), TODAY, { hasCalved: true })).toBe("cow");
  });

  it("calls anything under a year a calf, either sex", () => {
    // Heifer calves and bull calves are calves until they are yearlings,
    // which is how the herd is spoken about here.
    expect(cattleClass(beast("female", 120), TODAY)).toBe("calf");
    expect(cattleClass(beast("male", 120), TODAY)).toBe("calf");
  });

  it("turns a calf into a heifer or a bull on its first birthday", () => {
    expect(cattleClass(beast("female", CALF_MAX_DAYS - 1), TODAY)).toBe("calf");
    expect(cattleClass(beast("female", CALF_MAX_DAYS), TODAY)).toBe("heifer");
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
    expect(cattleClass(beast("female"), TODAY)).toBe("heifer");
    expect(cattleClass(beast("male"), TODAY)).toBe("bull");
  });

  it("refuses to guess when nobody recorded a sex", () => {
    expect(cattleClass(beast("unknown", 900), TODAY)).toBeUndefined();
  });
});

describe("the herd split by class", () => {
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

    // Both grown females read as heifers with no calvings supplied.
    expect(of("cow")).toBe(0);
    expect(of("heifer")).toBe(2);
    expect(of("bull")).toBe(1);
    expect(of("steer")).toBe(1);
    expect(of("calf")).toBe(2);
  });

  it("counts a donor as a cow even when every calf came out of a recipient", () => {
    // Two females behind one calf: the recipient carried and calved it, the
    // donor produced it. Both have had calves, and filing the donor as a
    // maiden heifer beside her own daughters is plainly wrong.
    const donor = "01ARZ3NDEKTSV4RRFFQ69G5FD1" as never;
    const recip = "01ARZ3NDEKTSV4RRFFQ69G5FR1" as never;
    const breeding = "01ARZ3NDEKTSV4RRFFQ69G5FB1" as never;

    const calved = damsThatHaveCalved(
      [{ damId: recip, breedingRecordId: breeding }],
      [{ id: breeding, embryoDonorId: donor }],
    );

    expect(calved.has(donor)).toBe(true);
    expect(calved.has(recip)).toBe(true);
  });

  it("does not promote a heifer merely for having been flushed", () => {
    // A heifer can be flushed before she has ever carried anything, so being a
    // donor is a plan rather than a calf on the ground. What counts is a
    // calving that names her breeding.
    const donor = "01ARZ3NDEKTSV4RRFFQ69G5FD2" as never;
    const breeding = "01ARZ3NDEKTSV4RRFFQ69G5FB2" as never;

    const calved = damsThatHaveCalved([], [{ id: breeding, embryoDonorId: donor }]);

    expect(calved.has(donor)).toBe(false);
  });

  it("cannot attribute a calving that names no breeding", () => {
    // The cost of that precision, stated: the donor behind an unlinked calving
    // stays a heifer until the two are joined up. Visible and fixable, unlike
    // silently promoting maiden heifers.
    const recip = "01ARZ3NDEKTSV4RRFFQ69G5FR2" as never;
    const donor = "01ARZ3NDEKTSV4RRFFQ69G5FD3" as never;

    const calved = damsThatHaveCalved(
      [{ damId: recip }],
      [{ id: "01ARZ3NDEKTSV4RRFFQ69G5FB3" as never, embryoDonorId: donor }],
    );

    expect(calved.has(donor)).toBe(false);
  });

  it("moves a female to cows once a calving is on file", () => {
    const dolly = { ...beast("female", 1200), id: "01ARZ3NDEKTSV4RRFFQ69G5FA1" as never };
    const calved = damsThatHaveCalved([{ damId: dolly.id }]);

    const counts = classCounts([dolly], TODAY, calved);
    const of = (name: string) => counts.find((entry) => entry.cattleClass === name)?.count;

    expect(of("cow")).toBe(1);
    expect(of("heifer")).toBe(0);
  });

  it("keeps the order fixed, so it is not re-read every morning", () => {
    // A row of numbers that reorders itself as calves are born has to be read
    // word by word every time.
    expect(classCounts(herd, TODAY).map((entry) => entry.cattleClass)).toEqual([
      "cow",
      "heifer",
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
