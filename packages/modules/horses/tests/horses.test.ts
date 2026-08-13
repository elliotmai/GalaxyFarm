import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import {
  concerns,
  describeHeight,
  describeHorse,
  disciplineFit,
  horseCandidateSchema,
  isHandsFraction,
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

describe("isHandsFraction", () => {
  it("is the rule the schema enforces, available to a form as it is typed", () => {
    // Same predicate, two callers: the message on the field and the reason a
    // save was refused cannot say different things.
    expect(isHandsFraction(15.3)).toBe(true);
    expect(isHandsFraction(16)).toBe(true);
    expect(isHandsFraction(15.4)).toBe(false);
    expect(isHandsFraction(15.9)).toBe(false);
  });

  it("refuses a number that is not one", () => {
    // A half-typed box reads back as NaN, and "not a height yet" is the right
    // answer to that rather than a crash or a quiet pass.
    expect(isHandsFraction(Number.NaN)).toBe(false);
  });
});

describe("describeHorse", () => {
  it("says what it is in the order a listing is skimmed", () => {
    expect(describeHorse(detail)).toBe("8 yo gelding · 15.2 hh · Quarter Horse · solid");
  });

  it("leaves out what the listing does not say", () => {
    // Four "unknown"s say less than a short line, and most listings start
    // this sparse.
    expect(
      describeHorse({
        candidateId: id(3),
        sex: "mare",
        disciplines: [],
        soundness: "unknown",
        vetCheckDone: false,
      }),
    ).toBe("mare");
  });

  it("writes a training level the way it is said, not the way it is stored", () => {
    expect(describeHorse({ ...detail, trainingLevel: "green_broke" })).toContain("green broke");
  });
});

describe("disciplineFit", () => {
  it("distinguishes a horse that does not do this from one nobody has said", () => {
    // A listing naming no disciplines has not said no. Hiding it would lose
    // the horse you have not asked about yet.
    expect(disciplineFit(detail, "ranch")).toBe("listed");
    expect(disciplineFit(detail, "reining")).toBe("not_listed");
    expect(disciplineFit({ ...detail, disciplines: [] }, "ranch")).toBe("unstated");
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
