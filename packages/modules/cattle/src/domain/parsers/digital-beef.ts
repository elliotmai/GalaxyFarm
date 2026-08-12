import { CHIANINA } from "./chianina.js";
import type { DigitalBeefBreed } from "./digital-beef-breed.js";
import { MAINE_ANJOU } from "./maine-anjou.js";
import type { GeneticTest } from "../genetics.js";
import {
  escape,
  looksLikeRegistration,
  parseAncestorDetail,
  parseDefectCode,
  splitParent,
  textOf,
  type FieldReader,
  type ImportedAncestor,
  type ImportedAnimal,
  type ImportedParent,
} from "./page.js";
import { SHORTHORN } from "./shorthorn.js";

/**
 * The Digital Beef engine, shared by three associations (spec §5.2, §12 #1).
 *
 * Decision log #1 said not to build an import against Digital Beef, because the
 * associations expose nothing programmatically. The owner overrode it, and the
 * reason it was made still holds: there is no API, so this parses a page built
 * for a person to look at, and it will break the day somebody changes the
 * template.
 *
 * Three sites, one application, three *templates* — and the differences are not
 * cosmetic: AMAA prints `reg [tattoo] name`, ACA prints `reg name [tattoo]`,
 * ASA prints `reg [tattoo] name` and then a second line with colour and date of
 * birth. What each of them does differently lives in its own file —
 * `chianina.ts`, `maine-anjou.ts`, `shorthorn.ts` — and what they share lives
 * here. Adding a fourth association is a new file, not a fourth branch in six
 * functions.
 *
 * Two rules run through everything below.
 *
 * **A value stops where the next label starts.** The detail panel is two
 * columns of label/value pairs, so a flattened row reads `Sex: Bull    Sire:
 * MA364424 CMAC TYSON ET`. Taking "everything after the label to the end of the
 * line" gives the sire's name as the animal's sex. Every known label is
 * therefore also a *terminator*.
 *
 * **The pedigree is an in-order traversal.** The chart is a tree lying on its
 * side with each animal centred between its parents' subtrees, and flattened to
 * text that is in-order — which is what makes the chart recoverable, because
 * the position of every ancestor follows from its index.
 */

/** Every breed served by this template, in its own file. */
export const DIGITAL_BEEF_BREEDS: readonly DigitalBeefBreed[] = [
  MAINE_ANJOU,
  CHIANINA,
  SHORTHORN,
];

const BY_HOST = new Map(DIGITAL_BEEF_BREEDS.map((breed) => [breed.host, breed]));
const BY_ASSOCIATION = new Map(DIGITAL_BEEF_BREEDS.map((breed) => [breed.association, breed]));

export interface DigitalBeefRef {
  readonly url: string;
  readonly host: string;
  readonly association: string;
  readonly registration: string;
}

/**
 * Pull the association and the registration number out of a pasted URL.
 *
 * Accepts the whole address off the address bar, since that is what somebody
 * will paste. Rejects a host it does not know rather than guessing: a URL from
 * a fourth association would parse into numbers filed under the wrong registry,
 * and a registration number means nothing apart from the registry that issued
 * it.
 */
export function parseDigitalBeefUrl(
  input: string,
): { ok: true; ref: DigitalBeefRef } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "That is not a web address." };
  }

  const host = url.hostname.toLowerCase();
  const breed = BY_HOST.get(host);
  if (breed === undefined) {
    return {
      ok: false,
      reason: `${host} is not one of the Digital Beef sites this farm registers with (${DIGITAL_BEEF_BREEDS.map((entry) => entry.breed).join(", ")}).`,
    };
  }

  const registration =
    url.searchParams.get("animal_registration") ?? url.searchParams.get("registration");
  if (registration === null || registration.trim() === "") {
    return {
      ok: false,
      reason:
        "That address has no animal registration number on it. Open the animal's own page and copy the address from there.",
    };
  }

  return {
    ok: true,
    ref: {
      url: url.toString(),
      host,
      association: breed.association,
      registration: registration.trim(),
    },
  };
}

/** Build the address for a registration number, for the fetch and for a link back. */
export function digitalBeefUrl(association: string, registration: string): string | undefined {
  const breed = BY_ASSOCIATION.get(association);
  if (breed === undefined) return undefined;
  return `https://${breed.host}/modules.php?op=modload&name=_animal&file=_animal&animal_registration=${encodeURIComponent(registration)}`;
}
/* ---------------------------------------------------------------- labels */

/**
 * Every label the three templates print, longest first.
 *
 * Longest first matters: "Herd Prefix/Tattoo" has to win against "Tattoo", or
 * the tattoo lookup anchors halfway through another label's text.
 *
 * The list is doing two jobs. It finds a field, and — more importantly — it
 * *ends* one. The detail panel is two columns, so every value on a row is
 * followed by the next column's label, and the only reliable way to know where
 * a value stops is to know what a label looks like.
 */
const LABELS: readonly string[] = [
  "Herd Prefix/Tattoo",
  "International ID",
  "Registered AN",
  "Genetic Makeup",
  "Classification",
  "Service Type",
  "Tattoo - LE",
  "Tattoo - RE",
  "Herd Prefix",
  "Animal Name",
  "Registration",
  "Right Ear",
  "Left Ear",
  "Disposal",
  "Breeder",
  "Tattoo",
  "Status",
  "Colour",
  "Color",
  "Owner",
  "Name",
  "Sire",
  "Sex",
  "DOB",
  "COI",
  "EID",
  "Age",
  "Dam",
  "LE",
  "RE",
]
  .slice()
  .sort((left, right) => right.length - left.length);

/**
 * `Horn/Poll/Scur` and the breed-percentage labels, which are patterns.
 *
 * The horn label is spelled the same on all three sites and is the *only*
 * place any of them records it. An earlier version looked for "Polled" and
 * "Horned" as labels and read the horn status of a Shorthorn as "SHORTHORNS",
 * off a breeder's name four hundred lines down the page.
 *
 * The percentage label carries the breed in its own name — "Chianina %",
 * "Shorthorn %" — so it has to be matched as a shape rather than listed.
 */
const HORN_LABEL = "Horn/Poll/Scur";

const LABEL_ALTERNATION = [...LABELS, escape(HORN_LABEL)].map(escape).join("|");
/** Where the *next* field starts. Used to cut a value off at the column edge. */
const NEXT_LABEL = new RegExp(`(?<![A-Za-z])(?:${LABEL_ALTERNATION}|[A-Z][a-z]{2,15}\\s*%)\\s*:`);

/**
 * The value sitting next to a label, stopping where the next label starts.
 *
 * Empty is returned as undefined, because an empty cell — AMAA's "Right Ear"
 * on an animal tattooed in the left — is the same answer as no cell at all,
 * and both are different from "we could not find where to look".
 */
export function fieldValue(text: string, labels: readonly string[]): string | undefined {
  for (const label of labels) {
    const anchor = new RegExp(`(?<![A-Za-z])${escape(label)}\\s*:`, "i");
    const found = anchor.exec(text);
    if (found === null) continue;

    const after = text.slice(found.index + found[0].length).split("\n");

    // The rest of the label's own line, and — when the template wrapped the
    // cell — the line under it. Chianina puts the herd prefix on the next
    // line. Reading it is safe because a line that begins with another label
    // cuts to nothing, which is exactly what an empty cell should give.
    for (const candidate of [after[0], after[1]]) {
      if (candidate === undefined) continue;
      const line = candidate.replace(/^[\s\t]+/, "");
      const cut = NEXT_LABEL.exec(line);
      const value = (cut === null ? line : line.slice(0, cut.index))
        .replace(/[\s\t]+/g, " ")
        .replace(/[\s:,;·|-]+$/, "")
        .trim();
      if (value !== "" && value !== "-") return value;
    }
  }
  return undefined;
}


interface Token {
  readonly kind: "entry" | "gap" | "sire" | "dam";
  readonly entry?: ImportedAncestor;
}

/**
 * One ancestor's line.
 *
 * Three spellings, one shape. Whatever else moves, the tattoo is in square
 * brackets and the registration number is the token that looks like a number,
 * so the name is what is left over.
 */
export function parsePedigreeEntry(line: string, branch: string): ImportedAncestor | undefined {
  let rest = line.replace(/^(?:connector\b\s*)+/i, "").replace(/^[\s\t]+/, "");

  // Chianina separates the flags with a double dash; Shorthorn just runs them
  // on after the name. Take the marked form first, then strip any trailing
  // tokens that are unmistakably flags.
  const tests: GeneticTest[] = [];
  const marked = /\s--\s*([A-Z0-9 ]+)\s*$/.exec(rest);
  if (marked !== null) {
    for (const code of (marked[1] ?? "").split(/\s+/)) {
      const test = parseDefectCode(code);
      if (test !== undefined) tests.push(test);
    }
    rest = rest.slice(0, marked.index);
  }
  for (;;) {
    const trailing = /(?:^|[\s\t])([A-Z]{2,6})[ \t]*$/.exec(rest);
    if (trailing === null) break;
    const test = parseDefectCode(trailing[1] ?? "");
    if (test === undefined) break;
    tests.unshift(test);
    rest = rest.slice(0, trailing.index);
  }

  let tattoo: string | undefined;
  let before = rest;
  let after = "";
  const bracket = /\[([^\]]*)\]/.exec(rest);
  if (bracket !== null) {
    const inside = (bracket[1] ?? "").trim();
    if (inside !== "") tattoo = inside;
    before = rest.slice(0, bracket.index);
    after = rest.slice(bracket.index + bracket[0].length);
  }

  const cell = (value: string): string => value.replace(/[\s\t]+/g, " ").trim();
  let registration: string | undefined;
  let name: string | undefined;

  if (cell(after) !== "") {
    // AMAA and ASA: `reg  [ tattoo ]  name`.
    registration = cell(before);
    name = cell(after);
  } else {
    // ACA: `reg  name  [ tattoo ]`. Registered numbers never contain a space,
    // so the first cell is the number and everything after it is the name.
    const parts = before.split(/\t|\s{2,}/).map(cell).filter((part) => part !== "");
    registration = parts.shift();
    name = parts.join(" ");
    if (registration !== undefined && !looksLikeRegistration(registration)) {
      // No number at all — an ancestor recorded by name only.
      name = cell(before);
      registration = undefined;
    }
  }

  if (registration !== undefined && !looksLikeRegistration(registration)) return undefined;
  if ((name === undefined || name === "") && registration === undefined) return undefined;

  return {
    ...(name === undefined || name === "" ? {} : { name }),
    ...(registration === undefined ? {} : { regNumber: registration }),
    ...(tattoo === undefined ? {} : { tattoo }),
    geneticTests: tests,
    branch,
  };
}


/**
 * A seven-slot subtree, in the order the chart prints it.
 *
 * Digital Beef draws the pedigree as a tree lying on its side with each animal
 * vertically centred between its two parents' subtrees. Flattened to text, that
 * is an **in-order traversal** — and in-order is what makes the chart
 * recoverable, because the position of every ancestor follows from its index
 * without knowing anything about the table it was drawn in.
 *
 * For a subtree rooted at X:
 *
 *     1  X's sire's sire        4  X                  7  X's dam's dam
 *     2  X's sire               5  X's dam's sire
 *     3  X's sire's dam         6  X's dam
 *
 * Verified against a Maine-Anjou page where the same animal appears with a
 * complete chart: `JAZX MS 720G` sits at slot 6 of the dam's-dam subtree, out
 * of `JAZX MS DESIGN 012D` at slot 7 by `DESIGNED BY SHOWTIME` at slot 5.
 */
const SUBTREE = [
  { suffix: "sire's sire", depth: 2 },
  { suffix: "sire", depth: 1 },
  { suffix: "sire's dam", depth: 2 },
  { suffix: undefined, depth: 0 },
  { suffix: "dam's sire", depth: 2 },
  { suffix: "dam", depth: 1 },
  { suffix: "dam's dam", depth: 2 },
] as const;

const SUBTREE_SLOTS = SUBTREE.length;

/**
 * Slot → the slot of its child, in the seven-slot in-order layout.
 *
 * 1 and 3 are slot 2's parents; 5 and 7 are slot 6's; 2 and 6 are the root's.
 * The root at 4 has no child inside the block.
 */
const CHILD_SLOT: Readonly<Record<number, number>> = { 0: 1, 2: 1, 4: 5, 6: 5, 1: 3, 5: 3 };

/**
 * Does this reading look like a printed pedigree?
 *
 * An ancestor recorded while the animal between it and the root is blank is
 * not something a chart prints — it is a misread offset. Cheap to check and it
 * is the only thing that tells a separator row from an empty first slot.
 */
function isCoherentChart(window: readonly Token[]): boolean {
  return window.every((token, index) => {
    if (token.kind !== "entry") return true;
    const child = CHILD_SLOT[index];
    return child === undefined || window[child]?.kind === "entry";
  });
}

/**
 * Place one subtree's ancestors, or decline to.
 *
 * A full block places by index. A short block places only if the blank rows
 * account exactly for what is missing — seven slots, entries plus gaps. Any
 * other shape returns undefined and the ancestors come back unplaced, because
 * the alternative is shifting everything below a gap up by one and calling a
 * great-grandsire a grandsire.
 */
export function placeSubtree(
  tokens: readonly Token[],
  root: string,
  rootGeneration: number,
): ImportedAncestor[] | undefined {
  const entries = tokens.filter((token) => token.kind === "entry");
  if (entries.length === 0) return [];

  const at = (slot: number, entry: ImportedAncestor): ImportedAncestor => {
    const shape = SUBTREE[slot];
    if (shape === undefined) return entry;
    return {
      ...entry,
      position: shape.suffix === undefined ? root : `${root}'s ${shape.suffix}`,
      generation: rootGeneration + shape.depth,
    };
  };

  const bySlot = (group: readonly Token[]): ImportedAncestor[] => {
    const placed: ImportedAncestor[] = [];
    group.forEach((token, index) => {
      if (token.kind === "entry") placed.push(at(index, token.entry as ImportedAncestor));
    });
    return placed;
  };

  // A complete block places by index, and a stray blank row in it is noise.
  if (entries.length === SUBTREE_SLOTS) {
    return entries.map((token, index) => at(index, token.entry as ImportedAncestor));
  }

  // A short block places only when the blank rows account for what is missing.
  // The chart is a table: an ancestor nobody recorded still renders a row, so a
  // seven-row block with blanks in it is unambiguous.
  //
  // The order these are tried in is the whole subtlety. A leading blank is
  // sometimes the separator between blocks and sometimes the *first slot* of
  // the block itself, and nothing in the text distinguishes them — so the run
  // that already measures seven wins, whichever end its blanks are on. The
  // Chianina page for ZNT TRIPLE X records exactly one of its dam's dam's four
  // grandparents, as three blanks, the animal, three blanks: dropping the
  // leading three first would put her in her own great-grandmother's slot.
  //
  // Leading gaps come off first, because the one row that is reliably *not* a
  // slot is the separator printed between blocks — it appears before the first
  // block and after each of the sire and dam rows. Only if that does not
  // measure seven is the run taken as printed.
  // Which row is the block's first slot, and which is the separator printed
  // between blocks, cannot be told apart by looking: both are blank. So every
  // reading is tried and the incoherent ones are thrown away.
  //
  // The rule that separates them is how a pedigree is printed, not how this
  // text happens to be shaped: **a chart never records a great-grandparent
  // without the grandparent between them.** Digital Beef prints the parent
  // whenever the child is known, so a filled slot whose own child slot is
  // blank is not a chart — it is this misreading its offset.
  //
  // That one rule settles both of the real pages that disagree. On ZNT MONTEGO
  // BAY the leading blank *is* a separator; on ZNT TRIPLE X it is the first of
  // three empty slots, and reading it as a separator would put his dam's dam
  // in her own daughter's place.
  const leadingGaps = tokens.findIndex((token) => token.kind !== "gap");
  const candidates: Token[][] = [];

  for (let skip = 0; skip <= Math.max(leadingGaps, 0); skip += 1) {
    const window = tokens.slice(skip, skip + SUBTREE_SLOTS);
    // Anything past the seventh row has to be blank — it is the separator
    // before whatever comes next, not an eighth ancestor.
    if (!tokens.slice(skip + SUBTREE_SLOTS).every((token) => token.kind === "gap")) continue;
    if (window.filter((token) => token.kind === "entry").length !== entries.length) continue;

    // A block whose tail was trimmed by the copy is padded back out. The
    // missing rows are blank slots either way.
    while (window.length < SUBTREE_SLOTS) window.push({ kind: "gap" });
    if (isCoherentChart(window)) candidates.push(window);
  }

  const distinct = new Set(
    candidates.map((window) =>
      window.map((token) => (token.kind === "entry" ? "x" : ".")).join(""),
    ),
  );
  if (distinct.size === 1 && candidates[0] !== undefined) return bySlot(candidates[0]);

  // No coherent reading, or more than one that disagree. A guess here shifts
  // every ancestor below the gap by a slot, which is how a great-grandsire
  // becomes a grandsire and every relatedness figure worked out afterwards is
  // quietly wrong. These come back unplaced instead.
  return undefined;
}

/**
 * Split the run between the sire and the dam into their two subtrees.
 *
 * The animal itself sits between them on the chart — it is printed above, not
 * in the tree — so the gap where it would be is the seam. Rather than trusting
 * one particular blank row, every gap is tried and the split that leaves both
 * halves resolvable is the one taken. When none does, the pair is treated as
 * one run of fourteen, and when that fails too the ancestors come back
 * unplaced.
 */
function splitMiddle(tokens: readonly Token[]): [Token[], Token[]] | undefined {
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "gap") continue;
    const left = tokens.slice(0, index);
    const right = tokens.slice(index + 1);
    if (
      placeSubtree(left, "x", 0) !== undefined &&
      placeSubtree(right, "x", 0) !== undefined &&
      left.some((entry) => entry.kind === "entry") &&
      right.some((entry) => entry.kind === "entry")
    ) {
      return [left, right];
    }
  }

  const entries = tokens.filter((token) => token.kind === "entry");
  if (entries.length === SUBTREE_SLOTS * 2) {
    return [entries.slice(0, SUBTREE_SLOTS), entries.slice(SUBTREE_SLOTS)];
  }
  return undefined;
}

const FURNITURE =
  /^(defect (key|color code)|free by (test|pedigree)|(suspected|possible|potential) carrier|carrier by test|affected by test|homozygous|green -|red -|purple -|orange -|\d+-generation pedigree|tab (left|right))/i;

const PEDIGREE_START = /(\d)\s*-\s*generation\s+pedigree/i;
const PEDIGREE_END = /(defect color code|digitalbeef,\s*llc|postnuke|a commercial producer)/i;

/**
 * Read the whole chart.
 *
 * Anchored on the words "5-Generation Pedigree" rather than on the first
 * mention of "pedigree" anywhere — the page has a row of navigation tabs above
 * the chart, one of which is labelled Pedigree, and starting there reads the
 * tab strip as an animal's ancestors. That is exactly what the first version
 * of this did, and it filed "tab left" as a grandsire.
 */
export function parsePedigreeBlock(
  text: string,
): { placed: ImportedAncestor[]; unplaced: ImportedAncestor[] } {
  const start = PEDIGREE_START.exec(text);
  if (start === null) return { placed: [], unplaced: [] };

  const region = text.slice(start.index + start[0].length);
  const end = PEDIGREE_END.exec(region);
  const block = end === null ? region : region.slice(0, end.index);

  const tokens: Token[] = [];
  const push = (line: string, branch: string) => {
    const entry = parsePedigreeEntry(line, branch);
    if (entry === undefined) {
      tokens.push({ kind: "gap" });
      return;
    }
    tokens.push({ kind: "entry", entry });
  };

  for (const raw of block.split("\n")) {
    const line = raw.replace(/^(?:connector\b\s*)+/i, "").trim();

    if (line === "" || /^[\s\t\-—·|]*$/.test(line)) {
      tokens.push({ kind: "gap" });
      continue;
    }
    if (FURNITURE.test(line)) continue;

    const parent = /^(sire|dam)\s*:/i.exec(line);
    if (parent !== null) {
      tokens.push({ kind: (parent[1] ?? "").toLowerCase() === "sire" ? "sire" : "dam" });
      const remainder = line.slice(parent[0].length).trim();
      if (remainder !== "") push(remainder, "");
      continue;
    }

    // An ancestor always arrives with a tattoo bracket or a registration
    // number — all three templates print both, empty brackets included.
    // Anything else on a chart line is Shorthorn's second line, which carries
    // colour, date of birth and breeder. Requiring one of those two marks is
    // what stops `Roan, 09/22/1955, LEWIS W. THIEMAN` being filed as a bull.
    const bracketed = /\[/.test(line);
    const numbered = line.split(/\t|\s{2,}/).some((part) => looksLikeRegistration(part.trim()));

    if (!bracketed && !numbered) {
      const previous = tokens.at(-1);
      const detail = parseAncestorDetail(line);
      if (previous?.kind === "entry" && Object.keys(detail).length > 0) {
        tokens[tokens.length - 1] = {
          kind: "entry",
          entry: { ...(previous.entry as ImportedAncestor), ...detail },
        };
      }
      continue;
    }

    push(line, "");
  }

  const sireAt = tokens.findIndex((token) => token.kind === "sire");
  const damAt = tokens.findIndex((token) => token.kind === "dam");
  if (sireAt < 0 || damAt < 0 || damAt < sireAt) {
    return { placed: [], unplaced: entriesOf(tokens, "unknown") };
  }

  const afterSire = tokens.slice(sireAt + 1, damAt);
  const afterDam = tokens.slice(damAt + 1);
  const sire = afterSire.find((token) => token.kind === "entry")?.entry;
  const dam = afterDam.find((token) => token.kind === "entry")?.entry;

  const placed: ImportedAncestor[] = [];
  const unplaced: ImportedAncestor[] = [];

  const resolve = (group: readonly Token[], root: string, branch: string) => {
    const slots = placeSubtree(group, root, 2);
    if (slots === undefined) {
      unplaced.push(...entriesOf(group, branch));
      return;
    }
    placed.push(...slots.map((entry) => ({ ...entry, branch })));
  };

  resolve(tokens.slice(0, sireAt), "sire's sire", "sire's sire's side");

  if (sire !== undefined) {
    placed.push({ ...sire, position: "sire", generation: 1, branch: "sire" });
  }
  const middle = afterSire.slice(afterSire.findIndex((token) => token.kind === "entry") + 1);
  const halves = splitMiddle(middle);
  if (halves === undefined) {
    unplaced.push(...entriesOf(middle, "between the sire and the dam"));
  } else {
    resolve(halves[0], "sire's dam", "sire's dam's side");
    resolve(halves[1], "dam's sire", "dam's sire's side");
  }

  if (dam !== undefined) {
    placed.push({ ...dam, position: "dam", generation: 1, branch: "dam" });
  }
  resolve(
    afterDam.slice(afterDam.findIndex((token) => token.kind === "entry") + 1),
    "dam's dam",
    "dam's dam's side",
  );

  return { placed, unplaced };
}

const entriesOf = (tokens: readonly Token[], branch: string): ImportedAncestor[] =>
  tokens
    .filter((token) => token.kind === "entry")
    .map((token) => ({ ...(token.entry as ImportedAncestor), branch }));

/* ------------------------------------------------------------ the animal */

/**
 * Every breed's rules at once, for a page nobody said the association of.
 *
 * The first breed that finds something wins. This is what the reader did
 * before the templates were separated, and it stays as the fallback because a
 * page with an unfamiliar association on it is still worth reading — refusing
 * would be a worse answer than a slightly generic one.
 */
const ANY_BREED: DigitalBeefBreed = {
  association: "other",
  breed: "unknown",
  host: "",
  pedigreeLayout: "reg-tattoo-name",
  tattooOf: (field) => {
    for (const entry of DIGITAL_BEEF_BREEDS) {
      const found = entry.tattooOf(field);
      if (found !== undefined) return found;
    }
    return undefined;
  },
  papersOf: (field) => {
    for (const entry of DIGITAL_BEEF_BREEDS) {
      const papers = entry.papersOf(field);
      if (papers.composition.length > 0 || papers.classification !== undefined) return papers;
    }
    return { composition: [] };
  },
};

/**
 * Read a whole animal page.
 *
 * Takes the page text rather than a URL: fetching is somebody else's job (a
 * browser cannot reach digitalbeef.com cross-origin, so it goes through a
 * server route, and when the host will not talk to a datacenter IP a person
 * pastes the page instead). Separating the two is what lets this be tested
 * against real saved pages from all three associations without a network.
 */
export function parseDigitalBeefPage(
  html: string,
  ref: Pick<DigitalBeefRef, "association" | "registration"> & { url?: string },
): ImportedAnimal {
  const text = textOf(html);
  const missing: string[] = [];

  const field: FieldReader = (labels) => fieldValue(text, labels);
  const take = (name: string, labels: readonly string[]): string | undefined => {
    const value = field(labels);
    if (value === undefined) missing.push(name);
    return value;
  };

  // Which template this is. Unknown associations get a reader that tries every
  // breed's rules in turn, which is what this did before any of them had a
  // file of its own — a page is worth reading even when nobody said whose.
  const breed = BY_ASSOCIATION.get(ref.association) ?? ANY_BREED;

  const name = take("Registered name", ["Animal Name", "Name"]);
  const sex = take("Sex", ["Sex", "Gender"]);
  const dob = take("Date of birth", ["DOB", "Birth Date", "Date of Birth"]);
  const colour = take("Colour", ["Color", "Colour"]);
  const hornStatus = take("Horn status", [HORN_LABEL]);

  // No two templates record a tattoo the same way, so each breed reads its
  // own. See `chianina.ts`, which has to join two cells back together.
  const tattoo = breed.tattooOf(field);
  if (tattoo === undefined) missing.push("Tattoo");

  const status = fieldValue(text, ["Status"]);
  const disposedOn = fieldValue(text, ["Disposal"]);
  const breeder = fieldValue(text, ["Breeder"]);
  const owner = fieldValue(text, ["Owner"]);
  const serviceType = fieldValue(text, ["Service Type"]);

  const coiRaw = fieldValue(text, ["COI"]);
  const coi = coiRaw === undefined ? undefined : Number.parseFloat(coiRaw.replace("%", ""));

  const sireRaw = fieldValue(text, ["Sire"]);
  const damRaw = fieldValue(text, ["Dam"]);
  const sire = sireRaw === undefined ? undefined : splitParent(sireRaw);
  const dam = damRaw === undefined ? undefined : splitParent(damRaw);

  // What the papers say this animal is. The single most divergent read on the
  // page — a full multi-breed makeup on Chianina, one number with a register
  // code glued to it on Shorthorn, no makeup at all on Maine-Anjou — so each
  // breed's file answers for itself.
  const { composition, classification } = breed.papersOf(field);

  const { placed, unplaced } = parsePedigreeBlock(text);
  if (placed.length === 0 && unplaced.length === 0) missing.push("Pedigree");

  // The detail panel names the parents outright, so it wins over the chart —
  // and fills them in when the chart could not be read at all.
  const ancestors = withParents(placed, sire, dam);

  return {
    association: ref.association,
    registration: ref.registration,
    ...(ref.url === undefined ? {} : { sourceUrl: ref.url }),
    ...(name === undefined ? {} : { name }),
    ...(tattoo === undefined ? {} : { tattoo }),
    ...(sex === undefined ? {} : { sex }),
    ...(dob === undefined ? {} : { dob }),
    ...(colour === undefined ? {} : { colour }),
    ...(hornStatus === undefined ? {} : { hornStatus }),
    ...(status === undefined ? {} : { status }),
    ...(disposedOn === undefined ? {} : { disposedOn }),
    ...(breeder === undefined ? {} : { breeder }),
    ...(owner === undefined ? {} : { owner }),
    ...(coi === undefined || !Number.isFinite(coi) ? {} : { coi }),
    ...(serviceType === undefined ? {} : { serviceType }),
    ...(classification === undefined ? {} : { classification }),
    ...(sire === undefined ? {} : { sire }),
    ...(dam === undefined ? {} : { dam }),
    breedComposition: composition,
    ancestors,
    unplacedAncestors: unplaced,
    missing,
  };
}

/** Make sure the sire and dam named in the detail panel are in the list. */
function withParents(
  placed: readonly ImportedAncestor[],
  sire: ImportedParent | undefined,
  dam: ImportedParent | undefined,
): ImportedAncestor[] {
  const result = [...placed];

  for (const [parent, position] of [
    [sire, "sire"],
    [dam, "dam"],
  ] as const) {
    if (parent === undefined) continue;
    const existing = result.findIndex((entry) => entry.position === position);
    if (existing >= 0) {
      const found = result[existing] as ImportedAncestor;
      result[existing] = {
        ...found,
        ...(found.regNumber === undefined && parent.regNumber !== undefined
          ? { regNumber: parent.regNumber }
          : {}),
        ...(found.name === undefined && parent.name !== undefined ? { name: parent.name } : {}),
      };
      continue;
    }
    result.push({ ...parent, geneticTests: [], position, generation: 1, branch: position });
  }

  return result;
}

/** Every association this template serves. */
export const IMPORTABLE_ASSOCIATIONS: readonly string[] = DIGITAL_BEEF_BREEDS.map(
  (breed) => breed.association,
);