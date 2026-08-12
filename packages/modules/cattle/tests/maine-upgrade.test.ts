import { describe, expect, it } from "vitest";

import {
  MAINE_CLASSES,
  maineClassFor,
  maineClassFromCode,
  mainePaper,
  mainePercent,
  maineProgeny,
  meetsMaineMinimum,
} from "../src/domain/maine-upgrade.js";

/**
 * The AMAA upgrading chart (§5.2).
 *
 * The point of every test here is that **the chart is not arithmetic**. A
 * Fullblood bull on a 3/8 cow gives 11/16 by halving — under 3/4 — and the
 * association registers the calf as 3/4. Anywhere the two disagree, the chart
 * is what papers actually get issued on, so the chart is what is encoded and
 * these tests are what stop somebody "simplifying" it into a formula.
 */

describe("the chart is not a calculation", () => {
  it("registers a Fullblood on a 3/8 as 3/4, where halving gives 11/16", () => {
    expect(maineProgeny("fullblood", "three_eighths").progeny).toBe("three_quarters");
  });

  it("registers a Fullblood on a 1/2 as 3/4, where halving gives 3/4", () => {
    expect(maineProgeny("fullblood", "half").progeny).toBe("three_quarters");
  });

  it("registers a 5/8 on a 3/4 as 5/8, where halving gives 11/16", () => {
    // The generous direction and the strict one both appear on the chart,
    // which is why neither can be derived.
    expect(maineProgeny("five_eighths", "three_quarters").progeny).toBe("five_eighths");
  });

  it("registers a 1/4 on a Fullblood as 5/8", () => {
    expect(maineProgeny("quarter", "fullblood").progeny).toBe("five_eighths");
  });
});

describe("the top of the chart", () => {
  it("keeps Fullblood only out of two Fullbloods", () => {
    expect(maineProgeny("fullblood", "fullblood").progeny).toBe("fullblood");
    expect(maineProgeny("purebred", "fullblood").progeny).toBe("purebred");
    expect(maineProgeny("fullblood", "purebred").progeny).toBe("purebred");
  });

  it("treats a Purebred sire the same as a Fullblood one below the top row", () => {
    for (const dam of ["three_quarters", "five_eighths", "half", "three_eighths", "quarter"] as const) {
      expect(maineProgeny("purebred", dam).progeny).toBe(maineProgeny("fullblood", dam).progeny);
    }
  });
});

describe("commercial and outside sires", () => {
  it("gives a half out of a commercial bull on a Fullblood cow", () => {
    expect(maineProgeny("commercial", "fullblood").progeny).toBe("half");
  });

  it("says what has to be filed before that calf can be registered", () => {
    expect(maineProgeny("commercial", "fullblood").conditions.join(" ")).toMatch(
      /commercial number/i,
    );
    expect(maineProgeny("outside_bull", "fullblood").conditions.join(" ")).toMatch(/pedigree/i);
  });

  it("says an unregistered dam costs the calf its bred-and-owned standing", () => {
    // Separate from eligibility: the calf registers, it just is not bred and
    // owned, and that is what a show entry turns on.
    expect(maineProgeny("fullblood", "commercial").conditions.join(" ")).toMatch(
      /bred and owned/i,
    );
  });

  it("refuses a pairing the chart does not print", () => {
    // Not an oversight in the chart — it falls under the quarter-Maine floor.
    const result = maineProgeny("commercial", "three_eighths");

    expect(result.progeny).toBeUndefined();
    expect(result.conditions.join(" ")).toMatch(/quarter-Maine floor/);
  });
});

describe("papers", () => {
  it("puts 1/4 through 5/8 on MaineTainer green", () => {
    for (const entry of ["quarter", "three_eighths", "half", "five_eighths"] as const) {
      expect(mainePaper(entry)).toBe("MaineTainer");
    }
  });

  it("puts 3/4 and up on High Maine brown", () => {
    for (const entry of ["three_quarters", "purebred", "fullblood"] as const) {
      expect(mainePaper(entry)).toBe("High Maine");
    }
  });

  it("puts a commercial animal on no paper at all", () => {
    expect(mainePaper("commercial")).toBeUndefined();
  });
});

describe("a percentage's class", () => {
  it("rounds down to the class actually earned", () => {
    // 70% is a 5/8, not a 3/4. Telling a breeder otherwise costs them a paper.
    expect(maineClassFor(70)).toBe("five_eighths");
    expect(maineClassFor(75)).toBe("three_quarters");
    expect(maineClassFor(99)).toBe("purebred");
    expect(maineClassFor(100)).toBe("fullblood");
  });

  it("allows for the association and this farm rounding differently", () => {
    expect(maineClassFor(87.2)).toBe("purebred");
  });

  it("calls anything under a quarter commercial", () => {
    expect(maineClassFor(20)).toBe("commercial");
    expect(meetsMaineMinimum(20)).toBe(false);
    expect(meetsMaineMinimum(25)).toBe(true);
  });
});

describe("reading a makeup", () => {
  it("adds up every spelling of Maine-Anjou", () => {
    expect(
      mainePercent([
        { breed: "MA", percent: 50 },
        { breed: "Maine-Anjou", percent: 25 },
        { breed: "AN", percent: 25 },
      ]),
    ).toBe(75);
  });
});

describe("the chart's shape", () => {
  it("covers every class as a dam for a Fullblood sire", () => {
    for (const dam of MAINE_CLASSES) {
      expect(maineProgeny("fullblood", dam).progeny).toBeDefined();
    }
  });
});

describe("the class the papers state", () => {
  it("reads the codes an AMAA certificate prints", () => {
    expect(maineClassFromCode("FB")).toBe("fullblood");
    expect(maineClassFromCode("PB")).toBe("purebred");
    expect(maineClassFromCode("3/4")).toBe("three_quarters");
    expect(maineClassFromCode("5/8")).toBe("five_eighths");
    expect(maineClassFromCode("1/2")).toBe("half");
    expect(maineClassFromCode("3/8")).toBe("three_eighths");
    expect(maineClassFromCode("1/4")).toBe("quarter");
  });

  it("ignores whitespace and case", () => {
    expect(maineClassFromCode(" pb ")).toBe("purebred");
  });

  it("refuses a code from another registry rather than guessing", () => {
    // The same field on a Chianina page reads `1CM`, which means something
    // else entirely — a wrong class here ends up in a sale catalogue.
    expect(maineClassFromCode("1CM")).toBeUndefined();
    expect(maineClassFromCode("SH100")).toBeUndefined();
  });
});
