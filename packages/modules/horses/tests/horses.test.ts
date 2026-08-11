import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import {
  concerns,
  describeHeight,
  horseCandidateSchema,
  type HorseCandidateDetail,
} from "../src/domain/horse-candidate.js";

/**
 * Horse candidates (spec §5.9).
 *
 * The module is a placeholder; this part is live because §5.9 says the
 * shopping surface should be years ahead of the module — horses are the
 * purchase furthest out and the one most worth researching slowly.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;

const detail: HorseCandidateDetail = {
  candidateId: id(1),
  breed: "Quarter Horse",
  sex: "gelding",
  ageYears: 8,
  heightHands: 15.2,
  trainingLevel: "solid",
  disciplines: ["ranch", "trail"],
  soundness: "sound",
  vetCheckDone: true,
  vetCheckNotes: "Clean flexions",
};

describe("horseCandidateSchema", () => {
  it("accepts a real listing", () => {
    expect(horseCandidateSchema.safeParse(detail).success).toBe(true);
  });

  it("refuses a height with a fourth of a hand", () => {
    // A hand is four inches, so the decimal runs .0 to .3. "15.4 hands" is
    // somebody typing centimetres or guessing.
    expect(horseCandidateSchema.safeParse({ ...detail, heightHands: 15.4 }).success).toBe(false);
    expect(horseCandidateSchema.safeParse({ ...detail, heightHands: 15.3 }).success).toBe(true);
  });

  it("refuses vet-check notes without a vet check", () => {
    const result = horseCandidateSchema.safeParse({ ...detail, vetCheckDone: false });
    expect(result.success).toBe(false);
  });

  it("accepts a listing with almost nothing filled in", () => {
    // Most listings start this way, and a schema that demanded more would stop
    // somebody recording a horse they just saw.
    const sparse = {
      candidateId: id(2),
      sex: "mare" as const,
      disciplines: [],
      soundness: "unknown" as const,
      vetCheckDone: false,
    };

    expect(horseCandidateSchema.safeParse(sparse).success).toBe(true);
  });
});

describe("describeHeight", () => {
  it("writes hands the way it is said out loud", () => {
    expect(describeHeight(15.2)).toBe("15.2 hh");
    expect(describeHeight(16)).toBe("16 hh");
  });

  it("says nothing for an unstated height", () => {
    expect(describeHeight(undefined)).toBeUndefined();
  });
});

describe("concerns", () => {
  it("names what to ask about before travelling to see one", () => {
    const found = concerns({
      ...detail,
      soundness: "unsound",
      vetCheckDone: false,
      vetCheckNotes: undefined,
      sex: "stallion",
      trainingLevel: "unhandled",
    });

    expect(found).toEqual([
      "Listed as unsound",
      "No vet check yet",
      "Stallion — handling and facilities",
      "Unhandled",
    ]);
  });

  it("distinguishes unsound from not stated", () => {
    expect(concerns({ ...detail, soundness: "unknown" })).toContain("Soundness not stated");
  });

  it("says nothing about a sound, vetted horse", () => {
    expect(concerns(detail)).toEqual([]);
  });
});
