import {
  parseDefectCode,
  textOf,
  type ImportedAncestor,
  type ImportedAnimal,
  type ImportedParent,
} from "./page.js";
import type { GeneticTest } from "../genetics.js";

/**
 * Reading an animal off the American Angus Association's site (spec §5.2).
 *
 * A Maine-Anjou pedigree cites Angus numbers — `AN13054003` — and there is
 * nothing at that number on any Digital Beef site. It is at angus.org, which is
 * a different application with a different page, so it gets its own reader
 * rather than a coat of paint on the Digital Beef one.
 *
 * The two pages agree on exactly one thing, and it is the important one: **the
 * pedigree is an in-order traversal.** Angus prints three generations rather
 * than five and leaves the animal's own row out of the list, which makes it
 * fourteen lines rather than thirty-one — but the shape is the same, so the
 * position of every ancestor still follows from its index.
 *
 * Everything else is different and is written against the real page:
 *
 * - The number is printed `AAA #+13054003`, with flags on the front. The page
 *   prints its own legend for them and this deliberately does not read it —
 *   the flags are stripped and the number kept, because getting `+` wrong
 *   would put "embryo transplant" on a bull that is not one.
 * - The defect strip is bracketed and dash-separated:
 *   `[ AMF-CAF-D2F-DDF-M1F-NHF-OHF-OSF ]`. Angus tests for more conditions
 *   than the other three, which is why `M1`, `OH` and `D2` had to be added to
 *   the defect list — an unlisted code is dropped, and a dropped carrier is
 *   the one failure this whole area exists to prevent.
 * - Two labels share a line: `Birth Date: 03/14/1998 Tattoo: 4480`. Every
 *   label is therefore also a terminator, the same rule as Digital Beef and
 *   for the same reason.
 */

/** The one hostname, and the query parameter it takes. */
const ANGUS_HOST = "www.angus.org";

export interface AngusRef {
  readonly url: string;
  readonly association: "Angus";
  readonly registration: string;
}

/** Build the address for a registration number, for a fetch or a link back. */
export function angusUrl(registration: string): string {
  return `https://${ANGUS_HOST}/find-an-animal?aid=${encodeURIComponent(registration.trim())}`;
}

/** Recognise an angus.org animal address and pull the number off it. */
export function parseAngusUrl(
  input: string,
): { ok: true; ref: AngusRef } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "That is not a web address." };
  }

  if (!url.hostname.toLowerCase().endsWith("angus.org")) {
    return { ok: false, reason: `${url.hostname} is not the American Angus Association's site.` };
  }

  const registration = url.searchParams.get("aid") ?? url.searchParams.get("registration");
  if (registration === null || registration.trim() === "") {
    return {
      ok: false,
      reason:
        "That address has no registration number on it. Open the animal's own page and copy the address from there.",
    };
  }

  return {
    ok: true,
    ref: { url: url.toString(), association: "Angus", registration: registration.trim() },
  };
}

/* ------------------------------------------------------------------ text */

/**
 * The labels on the detail panel.
 *
 * Doubles as the terminator list, because `Birth Date: 03/14/1998 Tattoo:
 * 4480` is one line with two fields on it and "everything after the label"
 * would file the tattoo as part of the birth date.
 */
const LABELS = [
  "Reg",
  "Birth Date",
  "Tattoo",
  "Parentage",
  "Genomic Prog",
  "Genomic",
  "Breeder",
  "First Owner",
  "Owner(s)",
  "Owner",
] as const;

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NEXT_LABEL = new RegExp(`(?<![A-Za-z])(?:${LABELS.map(escape).join("|")})\\s*:`);

function fieldValue(text: string, label: string): string | undefined {
  const anchor = new RegExp(`(?<![A-Za-z])${escape(label)}\\s*:`, "i");
  const found = anchor.exec(text);
  if (found === null) return undefined;

  const line = text.slice(found.index + found[0].length).split("\n")[0] ?? "";
  const next = NEXT_LABEL.exec(line);
  const value = (next === null ? line : line.slice(0, next.index)).trim();
  return value === "" ? undefined : value;
}

/**
 * Strip the flags the association prints in front of a number.
 *
 * `AAA #+13054003` is registration 13054003. The `#` and `+` are a legend the
 * page prints at the foot of the pedigree, and this does not read it: which
 * symbol means Pathfinder and which means embryo transplant is the
 * association's business, and recording the wrong one is worse than recording
 * neither.
 */
export function angusNumber(value: string): string | undefined {
  // Anchored, and that is the whole point. `Blackcap of R R 5367` ends in four
  // digits and is a *name*; an unanchored search calls it a registration and
  // then there is no name left to put beside it.
  const found = /^(?:AAA\s*)?[#+*]*\s*(\d{4,12})\s*$/.exec(value.trim());
  return found?.[1];
}

const SEXES: Record<string, string> = {
  BULL: "Bull",
  COW: "Cow",
  HEIFER: "Heifer",
  STEER: "Steer",
};

/** `[ AMF-CAF-D2F-DDF-M1F-NHF-OHF-OSF ]` — the whole strip, in one bracket. */
export function parseConditionStrip(value: string): GeneticTest[] {
  const tests: GeneticTest[] = [];
  for (const code of value.split(/[-,\s]+/)) {
    // `certain`: everything inside the bracket is a condition code, so an
    // unrecognised suffix is suspect rather than thrown away.
    const test = parseDefectCode(code, true);
    if (test !== undefined) tests.push(test);
  }
  return tests;
}

/* -------------------------------------------------------------- pedigree */

/**
 * Fifteen slots, in the order the chart prints them.
 *
 * A three-generation pedigree drawn as a tree on its side and flattened to
 * text is an in-order traversal, exactly as on Digital Beef. Slot 7 is the
 * animal itself and its row is not printed, so a complete list is fourteen
 * lines with a hole in the middle.
 *
 * The reading is checked by the names on the real page and not by arithmetic
 * alone: slot 3 comes out as `TC Stockman 365` with `TC Stockman` in slot 1,
 * and slot 11 as `Blackcap of R R 5367` with `Blackcap of R R 0238` in slot
 * 13. Herd prefixes running down the right branches is what a correct reading
 * looks like.
 */
const LAYOUT = [
  { suffix: "sire's sire's sire", depth: 3 },
  { suffix: "sire's sire", depth: 2 },
  { suffix: "sire's sire's dam", depth: 3 },
  { suffix: "sire", depth: 1 },
  { suffix: "sire's dam's sire", depth: 3 },
  { suffix: "sire's dam", depth: 2 },
  { suffix: "sire's dam's dam", depth: 3 },
  { suffix: undefined, depth: 0 },
  { suffix: "dam's sire's sire", depth: 3 },
  { suffix: "dam's sire", depth: 2 },
  { suffix: "dam's sire's dam", depth: 3 },
  { suffix: "dam", depth: 1 },
  { suffix: "dam's dam's sire", depth: 3 },
  { suffix: "dam's dam", depth: 2 },
  { suffix: "dam's dam's dam", depth: 3 },
] as const;

/** The animal's own slot, which the list leaves out. */
const SUBJECT_SLOT = 7;

/**
 * Slot → the slot of the animal it is a parent of.
 *
 * Used the same way as on Digital Beef: an ancestor recorded while the animal
 * between it and the subject is blank is not something a chart prints, it is a
 * misread offset.
 */
const CHILD_SLOT: Readonly<Record<number, number>> = {
  0: 1,
  2: 1,
  4: 5,
  6: 5,
  8: 9,
  10: 9,
  12: 13,
  14: 13,
  1: 3,
  5: 3,
  9: 11,
  13: 11,
  3: SUBJECT_SLOT,
  11: SUBJECT_SLOT,
};

const BRANCHES = ["sire", "dam"] as const;

/**
 * One pedigree line: `TC Stockman 365<tab>AAA #11994601`.
 *
 * The trailing bracket, when there is one, is that ancestor's condition strip
 * — `AAA #+10796576[RDF]`. It is read here rather than skipped because Digital
 * Beef taught the same lesson: an association prints an animal's test results
 * beside it on a *descendant's* chart and nowhere else.
 */
export function parseAngusPedigreeLine(line: string, branch: string): ImportedAncestor | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;

  let rest = trimmed;
  const tests: GeneticTest[] = [];
  const bracket = /\[([^\]]*)\]\s*$/.exec(rest);
  if (bracket !== null) {
    tests.push(...parseConditionStrip(bracket[1] ?? ""));
    rest = rest.slice(0, bracket.index);
  }

  // The registration cell is the one that carries the association's code or a
  // long run of digits. Everything before it is the name.
  const parts = rest
    .split(/\t|\s{2,}/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return undefined;

  const numbered = parts.findIndex((part) => angusNumber(part) !== undefined);
  if (numbered <= 0) {
    // No number, or nothing before it — a name-only ancestor, or a stray line.
    const name = parts.join(" ");
    return /^[A-Za-z]/.test(name) ? { name, geneticTests: tests, branch } : undefined;
  }

  const name = parts.slice(0, numbered).join(" ");
  const regNumber = angusNumber(parts[numbered] as string);

  return {
    ...(name === "" ? {} : { name }),
    ...(regNumber === undefined ? {} : { regNumber }),
    geneticTests: tests,
    branch,
  };
}

/**
 * Find the fourteen pedigree lines and put each one in its slot.
 *
 * The block is bounded by what surrounds it rather than by a heading, because
 * the page has none: the pedigree is the run of lines that parse as
 * `name → AAA number`, and it ends at the legend under it. Anything that is
 * not that shape stops the run.
 *
 * **A run that is not the right length is not placed.** Fourteen entries, or
 * a shorter run whose blanks account exactly for what is missing — anything
 * else comes back unplaced. Shifting the list up by one turns a
 * great-grandsire into a grandsire, and every relatedness figure worked out
 * afterwards is quietly wrong with nothing on screen looking unusual.
 */
export function parseAngusPedigree(text: string): {
  placed: ImportedAncestor[];
  unplaced: ImportedAncestor[];
} {
  const lines = text.split("\n");
  const runs: { entries: (ImportedAncestor | undefined)[]; from: number }[] = [];
  let current: (ImportedAncestor | undefined)[] = [];
  let from = 0;

  const flush = () => {
    // Trailing blanks belong to the page, not to the chart.
    while (current.length > 0 && current[current.length - 1] === undefined) current.pop();
    if (current.some((entry) => entry !== undefined)) runs.push({ entries: current, from });
    current = [];
  };

  lines.forEach((line, at) => {
    const entry = /(?:^|[\s\t])AAA[\s#+*]/.test(line)
      ? parseAngusPedigreeLine(line, "unknown")
      : undefined;

    if (entry !== undefined) {
      if (current.length === 0) from = at;
      current.push(entry);
      return;
    }
    // A blank line inside the run is an ancestor nobody recorded and holds the
    // slot open. Anything with words on it ends the run.
    if (line.trim() === "" && current.length > 0) current.push(undefined);
    else flush();
  });
  flush();

  const run = runs.sort((left, right) => right.entries.length - left.entries.length)[0];
  if (run === undefined) return { placed: [], unplaced: [] };

  const all = run.entries.filter((entry): entry is ImportedAncestor => entry !== undefined);
  const slots = toSlots(run.entries);
  if (slots === undefined) return { placed: [], unplaced: all };

  const placed: ImportedAncestor[] = [];
  slots.forEach((entry, slot) => {
    if (entry === undefined) return;
    const shape = LAYOUT[slot];
    if (shape === undefined || shape.suffix === undefined) return;
    placed.push({
      ...entry,
      position: shape.suffix,
      generation: shape.depth,
      branch: BRANCHES[slot < SUBJECT_SLOT ? 0 : 1] as string,
    });
  });

  return { placed, unplaced: [] };
}

/**
 * Line up a run against the fifteen slots, or decline to.
 *
 * The subject's slot is always the hole in the middle. A run of fourteen fills
 * every other slot in order; a run of fifteen is a page that printed the
 * subject's own row too, and the middle one is dropped. A short run is placed
 * only when its blanks account for what is missing *and* the result is a chart
 * that could actually have been printed.
 */
function toSlots(
  entries: readonly (ImportedAncestor | undefined)[],
): (ImportedAncestor | undefined)[] | undefined {
  const slots: (ImportedAncestor | undefined)[] = Array.from({ length: LAYOUT.length });

  if (entries.length === LAYOUT.length) {
    entries.forEach((entry, at) => {
      slots[at] = entry;
    });
  } else if (entries.length === LAYOUT.length - 1) {
    entries.forEach((entry, at) => {
      slots[at < SUBJECT_SLOT ? at : at + 1] = entry;
    });
  } else {
    return undefined;
  }

  // An ancestor recorded while the animal between it and the subject is blank
  // is a misread, not a pedigree.
  const coherent = slots.every((entry, slot) => {
    if (entry === undefined) return true;
    const child = CHILD_SLOT[slot];
    return child === undefined || child === SUBJECT_SLOT || slots[child] !== undefined;
  });

  return coherent ? slots : undefined;
}

/* ------------------------------------------------------------- the animal */

const parentAt = (
  placed: readonly ImportedAncestor[],
  position: string,
): ImportedParent | undefined => {
  const found = placed.find((entry) => entry.position === position);
  if (found === undefined) return undefined;
  return {
    ...(found.regNumber === undefined ? {} : { regNumber: found.regNumber }),
    ...(found.name === undefined ? {} : { name: found.name }),
  };
};

/**
 * Read a whole Angus page.
 *
 * Takes the page text rather than a URL, for the same reason the Digital Beef
 * reader does: fetching is somebody else's job, and separating the two is what
 * lets this be tested against a real saved page without a network.
 */
export function parseAngusPage(
  html: string,
  ref: Pick<AngusRef, "registration"> & { url?: string },
): ImportedAnimal {
  const text = textOf(html);
  const missing: string[] = [];

  // The name is the line above the registration. The page gives it no label of
  // its own, and the heading above it is the search box.
  const lines = text.split("\n").map((line) => line.trim());
  const regLine = lines.findIndex((line) => /^Reg\s*:/i.test(line));
  const name =
    regLine > 0
      ? lines
          .slice(0, regLine)
          .reverse()
          .find((line) => line !== "")
      : undefined;
  if (name === undefined) missing.push("Registered name");

  // Sex is on its own line under the number, unlabelled.
  const sex =
    regLine < 0
      ? undefined
      : lines
          .slice(regLine + 1, regLine + 4)
          .map((line) => SEXES[line.toUpperCase()])
          .find((found) => found !== undefined);
  if (sex === undefined) missing.push("Sex");

  const strip = /\[\s*([A-Z0-9]{2,4}(?:[-\s][A-Z0-9]{2,4})+)\s*\]/.exec(text);
  const geneticTests = strip === null ? [] : parseConditionStrip(strip[1] as string);

  const dob = fieldValue(text, "Birth Date");
  if (dob === undefined) missing.push("Date of birth");
  const tattoo = fieldValue(text, "Tattoo");
  if (tattoo === undefined) missing.push("Tattoo");

  const breeder = fieldValue(text, "Breeder");
  const owner = fieldValue(text, "Owner(s)") ?? fieldValue(text, "First Owner");

  const { placed, unplaced } = parseAngusPedigree(text);
  if (placed.length === 0 && unplaced.length === 0) missing.push("Pedigree");

  const sire = parentAt(placed, "sire");
  const dam = parentAt(placed, "dam");

  return {
    association: "other",
    registration: ref.registration,
    ...(ref.url === undefined ? {} : { sourceUrl: ref.url }),
    ...(name === undefined ? {} : { name }),
    ...(sex === undefined ? {} : { sex }),
    ...(dob === undefined ? {} : { dob }),
    ...(tattoo === undefined ? {} : { tattoo }),
    ...(breeder === undefined ? {} : { breeder }),
    ...(owner === undefined ? {} : { owner }),
    ...(sire === undefined ? {} : { sire }),
    ...(dam === undefined ? {} : { dam }),
    // The association prints no breed makeup: everything in the herdbook is
    // Angus. Left empty rather than assumed — an animal's makeup is worked out
    // from its papers elsewhere, and "100% AN" invented here would override a
    // Maine-Anjou page that actually knows.
    breedComposition: [],
    geneticTests,
    ancestors: placed,
    unplacedAncestors: unplaced,
    missing,
  };
}
