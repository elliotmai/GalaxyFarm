import type { DefectStatus, GeneticDefect, GeneticTest } from "../genetics.js";

/**
 * The pieces every association's page reader needs (spec §5.2).
 *
 * There is one of these files per breed, plus this. What lives here is what
 * does not change between them: what a registration number looks like, what a
 * defect flag means, what shape an imported animal comes back in. What lives
 * in a breed's own file is everything that made that page different from the
 * last one — and there was always something.
 *
 * The rules that earned their place, all of them the hard way:
 *
 * 1. **Nothing is matched by position on the page.** Fields are found by their
 *    *label*, because a redesign moves boxes around far more often than it
 *    renames the words a breeder reads.
 * 2. **A failed read says so.** Every field is optional and the result carries
 *    what it could not find, so a screen shows "could not read the horn
 *    status" and not a blank that reads as "no horn status".
 * 3. **Nothing is written from here.** The caller previews and a person saves,
 *    so a wrong parse costs a glance rather than a corrupted pedigree.
 * 4. **A code nobody recognised is never rounded down to "fine".** On a place
 *    whose house rule is that no carrier comes onto it, that is the one
 *    failure that matters.
 */


export const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
/**
 * Look a field up by its label.
 *
 * Handed to a breed's file so it can ask for its own labels without knowing
 * how the lookup works or which page it is reading.
 */
export type FieldReader = (labels: readonly string[]) => string | undefined;

/* --------------------------------------------------------- breed codes */

/**
 * The label's breed name, as the associations abbreviate it elsewhere.
 *
 * A Shorthorn page labels the field "Shorthorn %" and every other page writes
 * the breed as `SH`. Using the label verbatim would leave one animal recorded
 * as "100% Shorthorn" and its half-sibling as "50% SH", and nothing would
 * add them together.
 */
export const BREED_CODES: Record<string, string> = {
  shorthorn: "SH",
  chianina: "CA",
  "maine-anjou": "MA",
  maine: "MA",
  angus: "AN",
  hereford: "HH",
};
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

export const looksLikeRegistration = (token: string): boolean => REGISTRATION.test(token);

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
const DEFECT_CODE = /^(MSUD|PHA|TH|DS|DD|D2|M1|OH|AM|NH|CA|OS)(FT|FP|CT|AT|F|C|A|P|S|H)?$/;

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

/** The same, with any suffix at all — for a token already known to be a code. */
const LOOSE_DEFECT_CODE = /^(MSUD|PHA|TH|DS|DD|D2|M1|OH|AM|NH|CA|OS)([A-Z]{1,2})?$/;

/**
 * Read one flag. Unknown suffixes are suspect, never free.
 *
 * `certain` says the token came from somewhere that holds nothing but codes —
 * the bracket on an Angus page. Then an unrecognised suffix is *suspect*
 * rather than discarded, which matters: `AMZ` dropped is a result nobody sees,
 * and the one thing that must not happen is an animal reading as clear because
 * a code went unrecognised.
 *
 * Off a page where codes sit among words, the strict list applies instead. A
 * bull called `RED CAP` ends in a word that a loose reading calls "CA, free by
 * parentage", and inventing a clear test result is the same failure from the
 * other end.
 */
export function parseDefectCode(code: string, certain = false): GeneticTest | undefined {
  const match = (certain ? LOOSE_DEFECT_CODE : DEFECT_CODE).exec(code.trim().toUpperCase());
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

  return shares;
}

/**
 * Shorthorn's percentage field, which is a register code and a number.
 *
 * `SH100`, `AR50`, `AR25`, `0`. The letters are the **register** the animal
 * sits in, not a breed — and reading them as one was a real bug: an `AR50`
 * animal came out as "50% AR", a breed that does not exist, instead of half
 * Shorthorn. The field is labelled *Shorthorn %*, so whatever prefix it
 * carries, the number is the Shorthorn share.
 *
 * The code itself is kept verbatim rather than expanded, because what `AR`
 * stands for is the association's business and a wrong expansion on a sale
 * sheet is worse than the code a breeder already reads.
 */
export function parseShorthornPercent(
  value: string,
): { percent: number; register?: string } | undefined {
  const found = /^([A-Za-z]{0,4})\s*(\d{1,3}(?:\.\d+)?)\s*%?$/.exec(value.trim());
  if (found === null) return undefined;

  const register = (found[1] ?? "").toUpperCase();
  return {
    percent: Number(found[2]),
    ...(register === "" ? {} : { register }),
  };
}

/* ------------------------------------------------------------ the animal */

export interface ImportedParent {
  readonly regNumber?: string | undefined;
  readonly name?: string | undefined;
}

export interface ImportedAnimal {
  /**
   * Whoever issued the number.
   *
   * A string rather than the four this farm registers with, because the Angus
   * reader produces this shape too and `AAA` is a real answer that no amount
   * of narrowing makes wrong.
   */
  readonly association: string;
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
  /**
   * The class the papers state — `PB`, `FB`, `3/4`.
   *
   * Straight off the certificate and better than any arithmetic: the registry
   * decided it, the upgrading chart takes classes rather than fractions, and
   * an animal upgraded years ago can hold a class its makeup would not earn.
   * Kept as printed, because the same field on a Chianina page reads `1CM` and
   * means something else.
   */
  readonly classification?: string | undefined;
  readonly breedComposition: readonly { breed: string; percent: number }[];
  /**
   * The animal's own defect results, when the page prints them.
   *
   * Digital Beef never does — it prints an animal's tests only beside it on a
   * *descendant's* chart, which is why the chart has to be read at all. Angus
   * prints the whole strip on the animal's own page, so this is the one place
   * a subject's genetics arrive without a descendant.
   */
  readonly geneticTests?: readonly GeneticTest[] | undefined;
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
