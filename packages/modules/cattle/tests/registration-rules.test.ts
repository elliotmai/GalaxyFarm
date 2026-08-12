import { describe, expect, it } from "vitest";

import { registrationClasses } from "../src/domain/registration-rules.js";

/**
 * What a makeup buys you at the registry (spec §5.2).
 *
 * Transcribed from the association rules the owner supplied. The thresholds
 * are the whole content, so they are the whole test — and the Maine-Anjou case
 * is here specifically to prove the code says "not on file" rather than
 * inventing a class, because a wrong eligibility ends up in a sale catalogue.
 */

const names = (composition: { breed: string; percent: number }[]) =>
  registrationClasses(composition).classes.map((entry) => entry.name);

describe("Chianina", () => {
  it("calls 100% Fullblood", () => {
    expect(names([{ breed: "CA", percent: 100 }])).toContain("Fullblood Chianina");
  });

  it("calls 7/8 or better Purebred", () => {
    expect(names([{ breed: "CA", percent: 87.5 }, { breed: "AN", percent: 12.5 }])).toContain(
      "Purebred Chianina",
    );
    expect(names([{ breed: "CA", percent: 93 }, { breed: "AN", percent: 7 }])).toContain(
      "Purebred Chianina",
    );
  });

  it("does not call three-quarters Purebred", () => {
    expect(names([{ breed: "CA", percent: 75 }, { breed: "AN", percent: 25 }])).not.toContain(
      "Purebred Chianina",
    );
  });

  it("allows for the association and this farm rounding differently", () => {
    // 87.49 and 87.5 are the same animal. A strict comparison denies it a
    // class it plainly holds.
    expect(names([{ breed: "CA", percent: 87.2 }, { breed: "AN", percent: 12.8 }])).toContain(
      "Purebred Chianina",
    );
  });

  it("reads Chiangus as a ceiling on other breeds, not a floor on Chianina", () => {
    // The rule is "no more than 6.249% of another breed" — a quarter-Chi
    // animal on Angus qualifies, and a much higher-Chi animal with 10%
    // Shorthorn in it does not.
    expect(names([{ breed: "CA", percent: 25 }, { breed: "AN", percent: 75 }])).toContain(
      "Chiangus or Red Chiangus",
    );
    expect(
      names([
        { breed: "CA", percent: 50 },
        { breed: "AN", percent: 40 },
        { breed: "SH", percent: 10 },
      ]),
    ).not.toContain("Chiangus or Red Chiangus");
  });

  it("names what a percentage cannot settle", () => {
    const chiangus = registrationClasses([
      { breed: "CA", percent: 25 },
      { breed: "AN", percent: 75 },
    ]).classes.find((entry) => entry.name.startsWith("Chiangus"));

    // Colour, poll and registered parentage are conditions no makeup can
    // answer, so they are listed rather than assumed.
    expect(chiangus?.alsoRequires?.join(" ")).toMatch(/polled or scurred/i);
    expect(chiangus?.alsoRequires?.join(" ")).toMatch(/black or red/i);
  });

  it("calls Chianina on Hereford a Chiford", () => {
    expect(names([{ breed: "CA", percent: 50 }, { breed: "HH", percent: 50 }])).toContain("Chiford");
  });

  it("falls back to Percentage Chianina", () => {
    // Maine on the other side rather than Shorthorn, because 60% Shorthorn
    // would also be ShorthornPlus — which is right, and would make this test
    // about two things.
    expect(names([{ breed: "CA", percent: 40 }, { breed: "MA", percent: 60 }])).toEqual([
      "Percentage Chianina",
    ]);
  });
});

describe("Shorthorn", () => {
  it("calls 100% Purebred", () => {
    expect(names([{ breed: "SH", percent: 100 }])).toContain("Purebred Shorthorn");
  });

  it("calls half or better ShorthornPlus", () => {
    expect(names([{ breed: "SH", percent: 50 }, { breed: "MA", percent: 50 }])).toContain(
      "ShorthornPlus",
    );
  });

  it("calls under half nothing at all", () => {
    expect(names([{ breed: "SH", percent: 25 }, { breed: "MA", percent: 75 }])).not.toContain(
      "ShorthornPlus",
    );
  });
});

describe("what is not on file", () => {
  it("says the Maine-Anjou chart is missing rather than guessing at it", () => {
    // The upgrade chart is a PDF this could not read. A confidently wrong
    // class is worse than a blank one — it gets quoted in a catalogue.
    const verdict = registrationClasses([
      { breed: "MA", percent: 79.57 },
      { breed: "AN", percent: 20.43 },
    ]);

    expect(verdict.unknownRules).toMatch(/AMAA upgrade chart is not on file/);
    expect(verdict.classes).toEqual([]);
  });

  it("says so when there is no makeup at all", () => {
    expect(registrationClasses([]).unknownRules).toMatch(/No breed makeup/);
  });
});

describe("an animal papered twice", () => {
  it("qualifies under both associations at once", () => {
    // Which is the ordinary case on this farm, not an edge one.
    expect(names([{ breed: "CA", percent: 12.5 }, { breed: "SH", percent: 87.5 }])).toEqual([
      "Percentage Chianina",
      "ShorthornPlus",
    ]);
  });
});
