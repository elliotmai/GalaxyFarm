import { ASSOCIATIONS, type Association } from "./cattle-profile.js";
import { type DefectStatus, type GeneticDefect, type GeneticTest } from "./genetics.js";

/**
 * Reading an animal off a Digital Beef page (spec §5.2, §12 decision 1).
 *
 * Decision log #1 said not to build an import against Digital Beef, because the
 * three associations expose nothing programmatically. The owner overrode it,
 * and the reason it was made still holds: there is no API, so this parses a
 * page built for a person to look at, and it will break the day somebody
 * changes the template.
 *
 * Everything here is written for that eventuality:
 *
 * 1. **Nothing is matched by position on the page.** Fields are found by their
 *    *label* — "Registration", "Horn/Poll/Scur", "Genetic Makeup" — because a
 *    redesign moves boxes around far more often than it renames the words a
 *    breeder reads.
 * 2. **A value stops where the next label starts.** The detail panel is two
 *    columns of label/value pairs, so a flattened row reads
 *    `Sex: Bull    Sire: MA364424 CMAC TYSON ET`. Taking "everything after the
 *    label to the end of the line" gives the sire's name as the animal's sex.
 *    Every known label is therefore also a *terminator*.
 * 3. **A failed read says so.** Every field is optional and the result carries
 *    what it could not find, so the screen shows "could not read the horn
 *    status" and not a blank that reads as "no horn status".
 * 4. **Nothing is written from here.** The caller previews and a person saves,
 *    so a wrong parse costs a glance rather than a corrupted pedigree.
 *
 * The three sites are one application on three hostnames — but not one
 * template. Real pages from all three are checked into the tests, because the
 * differences are not cosmetic: AMAA prints `reg [tattoo] name`, ACA prints
 * `reg name [tattoo]`, ASA prints `reg [tattoo] name` and then a second line
 * with colour and date of birth. Every rule below was written against a page
 * that actually exists.
 */

/** The three this farm registers with, by the hostname Digital Beef serves. */
const HOST_ASSOCIATIONS: Record<string, Association> = {
  "maine-anjou.digitalbeef.com": "AMAA",
  "chianina.digitalbeef.com": "ACA",
  "shorthorn.digitalbeef.com": "ASA",
};

export interface DigitalBeefRef {
  readonly url: string;
  readonly host: string;
  readonly association: Association;
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
  const association = HOST_ASSOCIATIONS[host];
  if (association === undefined) {
    return {
      ok: false,
      reason: `${host} is not one of the Digital Beef sites this farm registers with (Maine-Anjou, Chianina, Shorthorn).`,
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
    ref: { url: url.toString(), host, association, registration: registration.trim() },
  };
}

/** Build the address for a registration number, for the fetch and for a link back. */
export function digitalBeefUrl(association: Association, registration: string): string | undefined {
  const host = Object.entries(HOST_ASSOCIATIONS).find(([, value]) => value === association)?.[0];
  if (host === undefined) return undefined;
  return `https://${host}/modules.php?op=modload&name=_animal&file=_animal&animal_registration=${encodeURIComponent(registration)}`;
}

/* ------------------------------------------------------------------ text */

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turn the page into lines, keeping the two things that carry meaning.
 *
 * **Tabs stay.** A tab is a former table cell, and it is what separates a
 * registration number from the name beside it.
 *
 * **Blank lines stay.** An empty row in the pedigree chart is an ancestor
 * nobody recorded, and it holds the slot open. Collapsing blank lines away —
 * which the obvious whitespace normalisation does — shifts every ancestor
 * below it up one, which puts a bull in his own grandfather's place.
 *
 * Handles a pasted page as readily as fetched HTML: a paste from a browser
 * already has the tabs and the blank rows, so the tag-stripping simply has
 * nothing to do.
 */
export function textOf(source: string): string {
  const html = /<(?:table|tr|td|th|div|body|html|br|span)\b/i.test(source);

  const text = html
    ? source
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:tr|div|p|table|li|h\d)>/gi, "\n")
        .replace(/<\/t[dh]>/gi, "\t")
        // The connector images between pedigree cells. Kept as a word rather
        // than dropped, because it marks a cell that holds an ancestor.
        .replace(/<img\b[^>]*>/gi, " connector ")
        .replace(/<[^>]+>/g, " ")
    : source;

  return text
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    // Runs of spaces are **not** collapsed. On a pasted page a run of spaces is
    // where one table cell ended and the next began, and it is the only thing
    // separating `MA185219` from `JF WAR CHIEF` on a Chianina pedigree line.
    .map((line) => line.replace(/[ \t]+$/, "").replace(/^[ \t]+/, ""))
    .join("\n")
    // Runs of blank lines are **not** collapsed either, and this one cost a
    // whole afternoon. Three blank rows in a pedigree block are three
    // ancestors nobody recorded, and squeezing them to one moves everything
    // below them two slots up. The Chianina page for ZNT TRIPLE X records one
    // of his dam's dam's grandparents as three blanks, the animal, three
    // blanks — collapse those and she lands in her own mother's place.
    .trim();
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
const PERCENT_LABEL = /(?<![A-Za-z])([A-Z][a-z]{2,15})\s*%\s*:/;

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

/* ---------------------------------------------------------- registration */

/**
 * A registration number as these three registries print one.
 *
 * `MA364424`, `264745`, `C102102`, `*x4058319`, `*sxAR30383`. The leading `*`
 * and the lowercase letters are Shorthorn's flags for how the animal is
 * recorded; they are kept, because the number as printed is what somebody will
 * check against the paper in the drawer.
 */
const REGISTRATION = /^\*?[A-Za-z]{0,4}\d{3,}$/;

const looksLikeRegistration = (token: string): boolean => REGISTRATION.test(token);

/* -------------------------------------------------------- defect codes */

/**
 * The defect flags Digital Beef prints beside an ancestor.
 *
 * `PHAF THF` on Shorthorn, `-- AMS DDS NHS PHAFT THFT` on Chianina. The
 * abbreviation is the defect, the suffix is where it stands.
 *
 * Only the suffixes worth acting on are mapped. Anything else lands as
 * `suspect`, which is not free and not carrier — because the one thing that
 * must not happen is a code nobody recognised being rounded down to "fine" on
 * a page where the house rule is that no carrier comes onto the place.
 */
const DEFECT_CODE = /^(MSUD|PHA|TH|DS|DD|AM|NH|CA|OS)(FT|FP|CT|AT|F|C|A|P|S|H)?$/;

const CODE_STATUS: Record<string, DefectStatus> = {
  F: "free",
  FT: "free",
  FP: "free_by_parentage",
  C: "carrier",
  CT: "carrier",
  A: "affected",
  AT: "affected",
  H: "affected",
};

/** Read one flag. Unknown suffixes are suspect, never free. */
export function parseDefectCode(code: string): GeneticTest | undefined {
  const match = DEFECT_CODE.exec(code.trim().toUpperCase());
  if (match === null) return undefined;

  const defect = match[1] as GeneticDefect;
  const suffix = match[2];

  return {
    defect,
    status: suffix === undefined ? "suspect" : (CODE_STATUS[suffix] ?? "suspect"),
    notes: `Read off the association's pedigree as "${code.trim()}"`,
  };
}

/* -------------------------------------------------------------- pedigree */

export interface ImportedAncestor {
  readonly name?: string | undefined;
  readonly regNumber?: string | undefined;
  readonly tattoo?: string | undefined;
  readonly colour?: string | undefined;
  readonly dob?: string | undefined;
  readonly breeder?: string | undefined;
  readonly geneticTests: readonly GeneticTest[];
  /**
   * "sire", "sire's dam's sire" — the path, in the words a breeder uses.
   *
   * Undefined when the chart had gaps that could not be accounted for. An
   * ancestor with no position is still worth importing; guessing at one is
   * not, because a wrong guess puts a bull on the wrong side of a pedigree and
   * every relatedness figure computed afterwards is quietly wrong.
   */
  readonly position?: string | undefined;
  /** Generations above the subject. 1 is a parent. */
  readonly generation?: number | undefined;
  /** Which quarter of the chart it came from, known even when the slot is not. */
  readonly branch: string;
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

const DATE = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/;

/**
 * Shorthorn's second line: `Roan, 09/22/1955, LEWIS W. THIEMAN`.
 *
 * Colour on an ancestor is worth having for its own sake — it is half of what
 * the coat-colour prediction needs, and on a pedigree that reaches back to
 * 1955 it is the only record of it that exists.
 */
export function parseAncestorDetail(line: string): Partial<ImportedAncestor> {
  const parts = line
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return {};

  const dob = parts.find((part) => DATE.test(part));
  const rest = parts.filter((part) => part !== dob);
  const [colour, ...breeder] = rest;

  return {
    ...(colour === undefined ? {} : { colour }),
    ...(dob === undefined ? {} : { dob }),
    ...(breeder.length === 0 ? {} : { breeder: breeder.join(", ") }),
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

/* ---------------------------------------------------------- composition */

/**
 * Breed composition, as Digital Beef writes it.
 *
 * Four spellings in the wild and all four are read: Chianina's
 * `3.72% CA | 79.57% MA | 14.41% AN`, the older `1/2 MA 1/4 CH`, Shorthorn's
 * `SH100`, and a bare number sitting next to a label that names the breed
 * itself. A composition that does not reach 100 is returned as found rather
 * than corrected, because the correction would be a guess about which share
 * was misread.
 */
export function parseComposition(value: string): { breed: string; percent: number }[] {
  const shares: { breed: string; percent: number }[] = [];

  const percentPattern = /(\d{1,3}(?:\.\d+)?)\s*%\s*([A-Za-z][A-Za-z\- ]{0,29}?)(?=\s|$|\d|\|)/g;
  for (const match of value.matchAll(percentPattern)) {
    shares.push({ breed: (match[2] ?? "").trim(), percent: Number(match[1]) });
  }
  if (shares.length > 0) return shares;

  const fractionPattern = /(\d+)\s*\/\s*(\d+)\s*([A-Za-z][A-Za-z\- ]{0,29}?)(?=\s|$|\d)/g;
  for (const match of value.matchAll(fractionPattern)) {
    const denominator = Number(match[2]);
    if (denominator === 0) continue;
    shares.push({
      breed: (match[3] ?? "").trim(),
      percent: Math.round((Number(match[1]) / denominator) * 10000) / 100,
    });
  }
  if (shares.length > 0) return shares;

  // Shorthorn's `SH100`.
  const joined = /^([A-Z]{2,4})\s*(\d{1,3}(?:\.\d+)?)$/.exec(value.trim());
  if (joined !== null) {
    return [{ breed: joined[1] as string, percent: Number(joined[2]) }];
  }

  return shares;
}

/* ------------------------------------------------------------ the animal */

export interface ImportedParent {
  readonly regNumber?: string | undefined;
  readonly name?: string | undefined;
}

export interface ImportedAnimal {
  readonly association: Association;
  readonly registration: string;
  readonly sourceUrl?: string | undefined;
  readonly name?: string | undefined;
  readonly tattoo?: string | undefined;
  readonly sex?: string | undefined;
  readonly dob?: string | undefined;
  readonly colour?: string | undefined;
  readonly hornStatus?: string | undefined;
  readonly status?: string | undefined;
  readonly disposedOn?: string | undefined;
  readonly breeder?: string | undefined;
  readonly owner?: string | undefined;
  /** The association's own inbreeding coefficient, as a percentage. */
  readonly coi?: number | undefined;
  /** How this animal itself was conceived — natural service or AI. */
  readonly serviceType?: string | undefined;
  readonly breedComposition: readonly { breed: string; percent: number }[];
  /** Sire and dam off the detail panel, which is more reliable than the chart. */
  readonly sire?: ImportedParent | undefined;
  readonly dam?: ImportedParent | undefined;
  readonly ancestors: readonly ImportedAncestor[];
  /** Read off the chart but not placeable — the chart had gaps in it. */
  readonly unplacedAncestors: readonly ImportedAncestor[];
  /** Field names the parser looked for and could not find. */
  readonly missing: readonly string[];
}

/** `Sire:  MA364424 <tab> CMAC TYSON ET` — the number and the name beside it. */
export function splitParent(value: string): ImportedParent | undefined {
  const parts = value
    .split(/\t|\s{2,}/)
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const single = parts.length === 1 ? (parts[0] as string).split(/\s+/) : parts;
  const first = single[0] ?? "";

  if (looksLikeRegistration(first)) {
    const name = single.slice(1).join(" ").trim();
    return { regNumber: first, ...(name === "" ? {} : { name }) };
  }
  const name = value.replace(/[\s\t]+/g, " ").trim();
  return name === "" ? undefined : { name };
}

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

  const take = (field: string, labels: readonly string[]): string | undefined => {
    const value = fieldValue(text, labels);
    if (value === undefined) missing.push(field);
    return value;
  };

  const name = take("Registered name", ["Animal Name", "Name"]);
  const sex = take("Sex", ["Sex", "Gender"]);
  const dob = take("Date of birth", ["DOB", "Birth Date", "Date of Birth"]);
  const colour = take("Colour", ["Color", "Colour"]);
  const hornStatus = take("Horn status", [HORN_LABEL]);

  // Three spellings of the same mark. Chianina splits it into a herd prefix
  // and a left-ear number and expects a person to read them together, so they
  // are joined back up rather than one of them being dropped.
  const prefix = fieldValue(text, ["Herd Prefix/Tattoo", "Herd Prefix"]);
  const ear = fieldValue(text, ["Tattoo - LE", "Left Ear", "LE", "Tattoo", "Tattoo - RE", "RE"]);
  const tattoo =
    prefix !== undefined && ear !== undefined && !ear.toUpperCase().startsWith(prefix.toUpperCase())
      ? `${prefix}${ear}`
      : (ear ?? prefix);
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

  // Chianina prints a full makeup; the other two print one breed's share next
  // to a label that names the breed.
  let compositionRaw = fieldValue(text, ["Genetic Makeup", "Breed Composition"]);
  let compositionBreed: string | undefined;
  if (compositionRaw === undefined) {
    const percentLabel = PERCENT_LABEL.exec(text);
    if (percentLabel !== null) {
      compositionBreed = percentLabel[1];
      compositionRaw = fieldValue(text, [`${compositionBreed as string} %`]);
    }
  }

  const composition =
    compositionRaw === undefined
      ? []
      : (() => {
          const parsed = parseComposition(compositionRaw);
          if (parsed.length > 0) return parsed;
          const bare = Number.parseFloat(compositionRaw);
          return compositionBreed !== undefined && Number.isFinite(bare)
            ? [{ breed: compositionBreed, percent: bare }]
            : [];
        })();

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

/** Every association this importer knows how to file numbers under. */
export const IMPORTABLE_ASSOCIATIONS: readonly Association[] = ASSOCIATIONS.filter(
  (association): association is Association =>
    Object.values(HOST_ASSOCIATIONS).includes(association),
);
