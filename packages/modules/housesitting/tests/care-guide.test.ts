import { describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

import {
  careGuideSchema,
  composeGuide,
  doNotHandleList,
  guideSectionSchema,
  type GuideSection,
  type GuideZone,
} from "../src/domain/care-guide.js";

/**
 * The care guide (spec §5.10).
 *
 * Read by somebody standing at a gate who cannot ask a follow-up question,
 * which is why every pen section leads with its safety level and why the
 * "do not handle" list names animals rather than a number.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;
const AT = new Date("2026-12-20T09:00:00Z");

const pasture: GuideZone = {
  id: id(1),
  name: "Pasture",
  baselineSafetyLevel: 2,
  customInstructions: "Gate chain, not the latch.",
  occupants: [{ id: id(10), name: "Andromeda", safetyLevel: 2, customInstructions: "No grain." }],
};

const bullPen: GuideZone = {
  id: id(2),
  name: "Pen B",
  baselineSafetyLevel: 2,
  occupants: [
    { id: id(11), name: "Atlas", safetyLevel: 5, safetyNotes: "Bull. Do not enter the pen." },
  ],
};

describe("composeGuide", () => {
  const guide = { title: "While we are away", intro: "Thank you." };

  it("derives each pen's effective level from its worst occupant", () => {
    // §5.1: max(zone baseline, most dangerous occupant). A green pen turns red
    // the moment the bull is moved into it.
    const composed = composeGuide(guide, [pasture, bullPen], [], AT);
    const pen = composed.pens.find((section) => section.zoneId === id(2));

    expect(pen?.effectiveLevel).toBe(5);
    expect(pen?.effectiveLabel).toBe("Do not handle");
  });

  it("puts the worst pen first", () => {
    // Somebody skimming this at the gate should meet the thing that can hurt
    // them before the thing that cannot.
    const composed = composeGuide(guide, [pasture, bullPen], [], AT);
    expect(composed.pens.map((section) => section.zoneName)).toEqual(["Pen B", "Pasture"]);
  });

  it("names the animals a helper must not approach, with the reason", () => {
    // "Level 5" means nothing to somebody feeding chickens as a favour.
    const composed = composeGuide(guide, [bullPen], [], AT);
    expect(doNotHandleList(composed)).toEqual(["Atlas — Bull. Do not enter the pen."]);
  });

  it("names an animal with no note rather than dropping it", () => {
    const unexplained: GuideZone = {
      ...bullPen,
      occupants: [{ id: id(12), name: "Nameless", safetyLevel: 4 }],
    };

    expect(doNotHandleList(composeGuide(guide, [unexplained], [], AT))).toEqual(["Nameless"]);
  });

  it("merges the pen's instructions with each animal's", () => {
    const composed = composeGuide(guide, [pasture], [], AT);
    const lines = composed.pens[0]?.instructions ?? [];

    expect(lines.map((line) => line.sourceName)).toEqual(["Pasture", "Andromeda"]);
  });

  it("honours a renamed safety level", () => {
    const composed = composeGuide(guide, [bullPen], [], AT, { 5: "Dad only, always" });
    expect(composed.pens[0]?.effectiveLabel).toBe("Dad only, always");
  });

  it("keeps hand-written sections in their stated order", () => {
    const custom: GuideSection[] = [
      {
        id: id(20),
        propertyId: id(0),
        createdAt: AT,
        updatedAt: AT,
        careGuideId: id(30),
        title: "The wifi",
        bodyMarkdown: "Password is on the fridge.",
        order: 2,
      },
      {
        id: id(21),
        propertyId: id(0),
        createdAt: AT,
        updatedAt: AT,
        careGuideId: id(30),
        title: "If something goes wrong",
        bodyMarkdown: "Call us first.",
        order: 1,
      },
    ];

    const composed = composeGuide(guide, [], custom, AT);
    expect(composed.custom.map((section) => section.title)).toEqual([
      "If something goes wrong",
      "The wifi",
    ]);
  });

  it("stamps when it was composed, because that is the guide's whole claim", () => {
    // Composed live rather than generated and saved: a guide that was right
    // when it was written is wrong the first time an animal moves pens.
    expect(composeGuide(guide, [], [], AT).generatedAt).toBe(AT);
  });

  it("copes with an empty farm", () => {
    const composed = composeGuide(guide, [], [], AT);
    expect(composed.pens).toEqual([]);
    expect(doNotHandleList(composed)).toEqual([]);
  });
});

describe("schemas", () => {
  it("refuses an empty hand-written section", () => {
    // An empty section is worse than none — it reads as "nothing to say here".
    const section = {
      id: id(20),
      propertyId: id(0),
      createdAt: AT,
      updatedAt: AT,
      careGuideId: id(30),
      title: "Notes",
      bodyMarkdown: "",
      order: 0,
    };

    expect(guideSectionSchema.safeParse(section).success).toBe(false);
  });

  it("accepts a guide", () => {
    const guide = {
      id: id(30),
      propertyId: id(0),
      createdAt: AT,
      updatedAt: AT,
      title: "While we are away",
      includes: ["pens" as const, "emergency_contacts" as const],
      active: true,
    };

    expect(careGuideSchema.safeParse(guide).success).toBe(true);
  });
});
