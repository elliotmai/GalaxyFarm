import { describe, expect, it } from "vitest";

import {
  hasInstructions,
  resolveCareInstructions,
  resolveZoneInstructions,
} from "../src/entities/care-instruction.js";
import {
  resolveSafetyLabels,
  safetyLabel,
  SAFETY_LEVEL_DEFAULTS,
} from "../src/value-objects/safety-level.js";
import type { Ulid } from "../src/types/ids.js";

/**
 * Care instruction resolution (spec §5.1) and configurable safety labels.
 *
 * Both are read by someone standing in a barn who cannot ask a follow-up
 * question, which is the whole reason each line keeps its source.
 */

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}` as Ulid;

const andromeda = { id: id(1), name: "Andromeda", customInstructions: "No grain — she founders." };
const penB = { id: id(2), name: "Pen B", customInstructions: "Latch sticks. Lift, then pull." };
const showString = { id: id(3), name: "Show string", customInstructions: "Rinse twice daily." };

describe("resolveCareInstructions", () => {
  it("puts the animal's own note first", () => {
    // The animal-level note is the exception — "she founders" — and an
    // exception underneath three paragraphs of pen routine is one nobody reads.
    const lines = resolveCareInstructions({
      animal: andromeda,
      zones: [penB],
      groups: [showString],
    });

    expect(lines.map((line) => line.source)).toEqual(["animal", "zone", "group"]);
  });

  it("attributes every line, so a helper knows what it applies to", () => {
    const [first] = resolveCareInstructions({ animal: andromeda, zones: [penB] });

    expect(first?.sourceName).toBe("Andromeda");
    expect(first?.sourceId).toBe(id(1));
  });

  it("merges both zones for a calf held inside and outside at once", () => {
    // §5.1: client calves hold two concurrent assignments. Reading only the
    // first would drop half the instructions.
    const barn = { id: id(4), name: "Barn stall 3", customInstructions: "Fan on above 85." };
    const lines = resolveCareInstructions({ animal: andromeda, zones: [penB, barn] });

    expect(lines.map((line) => line.sourceName)).toEqual(["Andromeda", "Pen B", "Barn stall 3"]);
  });

  it("skips blank and whitespace-only instructions rather than rendering empty rows", () => {
    const lines = resolveCareInstructions({
      animal: { id: id(5), name: "Nobody", customInstructions: "   " },
      zones: [{ id: id(6), name: "Pasture" }],
    });

    expect(lines).toEqual([]);
  });

  it("trims what it does keep", () => {
    const [line] = resolveCareInstructions({
      animal: { id: id(7), name: "Trim", customInstructions: "  Halter hangs on the gate.\n" },
      zones: [],
    });

    expect(line?.text).toBe("Halter hangs on the gate.");
  });
});

describe("hasInstructions", () => {
  it("is false when nothing anywhere has anything to say", () => {
    expect(hasInstructions({ animal: { id: id(8), name: "Quiet" }, zones: [] })).toBe(false);
  });

  it("is true when only the zone has something", () => {
    expect(hasInstructions({ animal: { id: id(9), name: "Quiet" }, zones: [penB] })).toBe(true);
  });
});

describe("resolveZoneInstructions", () => {
  it("states the pen's own note once, then each occupant's", () => {
    // Walking into a pen, not up to one animal: the gate latch is worth saying
    // once rather than once per cow standing behind it.
    const other = { id: id(10), name: "Dolly", customInstructions: "Leads well." };
    const lines = resolveZoneInstructions(penB, [andromeda, other]);

    expect(lines.map((line) => `${line.source}:${line.sourceName}`)).toEqual([
      "zone:Pen B",
      "animal:Andromeda",
      "animal:Dolly",
    ]);
  });

  it("says nothing for an empty pen with no notes", () => {
    expect(resolveZoneInstructions({ id: id(11), name: "West Pen" }, [])).toEqual([]);
  });

  it("puts the group it sits in between the pen and the animals standing in it", () => {
    // Most specific first, the same order as the animal's own merge: the pen
    // latch before the rule that covers the whole north end, and both before
    // whatever is true of one cow.
    const north = {
      id: id(12),
      name: "North",
      customInstructions: "Gate to the road stays chained.",
    };
    const lines = resolveZoneInstructions(penB, [andromeda], [north]);

    expect(lines.map((line) => `${line.source}:${line.sourceName}`)).toEqual([
      "zone:Pen B",
      "group:North",
      "animal:Andromeda",
    ]);
  });

  it("leaves a group with nothing to say out rather than rendering an empty row", () => {
    const quiet = { id: id(13), name: "South" };
    const lines = resolveZoneInstructions(penB, [], [quiet]);

    expect(lines.map((line) => line.sourceName)).toEqual(["Pen B"]);
  });
});

describe("configurable safety labels (§5.1)", () => {
  it("returns the defaults untouched when nothing is overridden", () => {
    expect(resolveSafetyLabels(undefined)).toBe(SAFETY_LEVEL_DEFAULTS);
  });

  it("overrides one level without disturbing the other four", () => {
    // Renaming level 4 should not require retyping the rest, and the four left
    // alone should keep tracking future wording changes to the defaults.
    const labels = resolveSafetyLabels({ 4: "Dad only" });

    expect(labels[4].label).toBe("Dad only");
    expect(labels[1].label).toBe(SAFETY_LEVEL_DEFAULTS[1].label);
    expect(labels[4].colorToken).toBe(SAFETY_LEVEL_DEFAULTS[4].colorToken);
  });

  it("looks up a single label with or without overrides", () => {
    expect(safetyLabel(5)).toBe("Do not handle");
    expect(safetyLabel(5, { 5: "Bull — nobody" })).toBe("Bull — nobody");
  });
});
