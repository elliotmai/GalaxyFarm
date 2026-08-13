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
    expect(
      names([
        { breed: "CA", percent: 87.5 },
        { breed: "AN", percent: 12.5 },
      ]),
    ).toContain("Purebred Chianina");
    expect(
      names([
        { breed: "CA", percent: 93 },
        { breed: "AN", percent: 7 },
      ]),
    ).toContain("Purebred Chianina");
  });

  it("does not call three-quarters Purebred", () => {
    expect(
      names([
        { breed: "CA", percent: 75 },
        { breed: "AN", percent: 25 },
      ]),
    ).not.toContain("Purebred Chianina");
  });

  it("allows for the association and this farm rounding differently", () => {
    // 87.49 and 87.5 are the same animal. A strict comparison denies it a
    // class it plainly holds.
    expect(
      names([
        { breed: "CA", percent: 87.2 },
        { breed: "AN", percent: 12.8 },
      ]),
    ).toContain("Purebred Chianina");
  });

  it("reads Chiangus as a ceiling on other breeds, not a floor on Chianina", () => {
    // The rule is "no more than 6.249% of another breed" — a quarter-Chi
    // animal on Angus qualifies, and a much higher-Chi animal with 10%
    // Shorthorn in it does not.
    expect(
      names([
        { breed: "CA", percent: 25 },
        { breed: "AN", percent: 75 },
      ]),
    ).toContain("Chiangus or Red Chiangus");
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
    expect(
      names([
        { breed: "CA", percent: 50 },
        { breed: "HH", percent: 50 },
      ]),
    ).toContain("Chiford");
  });

  it("falls back to Percentage Chianina", () => {
    // Twenty per cent Shorthorn in it, so it is over the Chiangus ceiling and
    // under the ShorthornPlus floor — Chianina genetics meeting no composite's
    // terms, which is exactly what the fallback class is for.
    expect(
      names([
        { breed: "CA", percent: 40 },
        { breed: "AN", percent: 40 },
        { breed: "SH", percent: 20 },
      ]),
    ).toEqual(["Percentage Chianina"]);
  });
});

describe("Shorthorn", () => {
  it("calls 100% Purebred", () => {
    expect(names([{ breed: "SH", percent: 100 }])).toContain("Purebred Shorthorn");
  });

  it("calls half or better ShorthornPlus", () => {
    expect(
      names([
        { breed: "SH", percent: 50 },
        { breed: "MA", percent: 50 },
      ]),
    ).toContain("ShorthornPlus");
  });

  it("calls under half nothing at all", () => {
    expect(
      names([
        { breed: "SH", percent: 25 },
        { breed: "MA", percent: 75 },
      ]),
    ).not.toContain("ShorthornPlus");
  });
});

describe("Maine-Anjou", () => {
  it("puts 3/4 and over on High Maine brown papers", () => {
    expect(
      names([
        { breed: "MA", percent: 79.57 },
        { breed: "AN", percent: 20.43 },
      ]).join(" "),
    ).toMatch(/High Maine — 3\/4/);
  });

  it("puts a half on MaineTainer green", () => {
    expect(
      names([
        { breed: "MA", percent: 50 },
        { breed: "AN", percent: 50 },
      ]).join(" "),
    ).toMatch(/MaineTainer — 1\/2/);
  });

  it("mentions Maine Angus on the fractions it can apply to", () => {
    // The blue paper covers 3/8 to 5/8 and the AMAA judges it on more than
    // the fraction, so it is named rather than claimed.
    const half = registrationClasses([
      { breed: "MA", percent: 50 },
      { breed: "AN", percent: 50 },
    ]).classes.find((entry) => entry.association === "AMAA");

    expect(half?.alsoRequires?.join(" ")).toMatch(/Maine Angus/);
  });

  it("refuses anything under a quarter", () => {
    expect(
      names([
        { breed: "MA", percent: 12.5 },
        { breed: "AN", percent: 87.5 },
      ]),
    ).toContain("Not eligible");
  });
});

describe("what is not on file", () => {
  it("says so when there is no makeup at all", () => {
    expect(registrationClasses([]).unknownRules).toMatch(/No breed makeup/);
  });
});

describe("an animal papered twice", () => {
  it("qualifies under both associations at once", () => {
    // Which is the ordinary case on this farm, not an edge one.
    expect(
      names([
        { breed: "CA", percent: 12.5 },
        { breed: "SH", percent: 87.5 },
      ]),
    ).toEqual(["Percentage Chianina", "ShorthornPlus"]);
  });
});

describe("the class an AMAA paper states", () => {
  it("wins over anything worked out from a percentage", () => {
    // An animal upgraded years ago can hold a class its current makeup would
    // not earn on its own, and the registry's decision is the one that counts.
    const stated = registrationClasses(
      [
        { breed: "MA", percent: 50 },
        { breed: "AN", percent: 50 },
      ],
      "PB",
    );

    expect(stated.classes.map((entry) => entry.name).join(" ")).toMatch(/High Maine — Purebred/);
    expect(stated.classes.find((entry) => entry.association === "AMAA")?.because).toMatch(
      /papers state PB/,
    );
  });

  it("falls back to the percentage when the papers say nothing", () => {
    expect(
      registrationClasses([
        { breed: "MA", percent: 50 },
        { breed: "AN", percent: 50 },
      ])
        .classes.map((entry) => entry.name)
        .join(" "),
    ).toMatch(/MaineTainer — 1\/2/);
  });

  it("falls back when the code belongs to another registry", () => {
    // `1CM` is a Chianina classification and says nothing about Maine-Anjou.
    expect(
      registrationClasses(
        [
          { breed: "MA", percent: 50 },
          { breed: "AN", percent: 50 },
        ],
        "1CM",
      )
        .classes.map((entry) => entry.name)
        .join(" "),
    ).toMatch(/MaineTainer/);
  });
});
