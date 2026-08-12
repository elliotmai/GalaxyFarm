import { ASSOCIATIONS, type Association } from "./cattle-profile.js";

/**
 * Reading a pedigree off a Digital Beef page (spec §5.2, §12 decision 1).
 *
 * Decision log #1 said not to build an import against Digital Beef, because
 * the three associations expose nothing programmatically. That decision has
 * been overridden by the owner, and the reason it was made still holds: there
 * is no API, so this parses a page that was built for a person to look at, and
 * it will break the day somebody changes the template.
 *
 * Everything here is written for that eventuality:
 *
 * 1. **Nothing is matched by CSS position.** Fields are found by their *label*
 *    — "Reg #", "Sire", "Dam" — because a redesign moves boxes around far more
 *    often than it renames the words a breeder reads.
 * 2. **A failed parse says so.** Every field is optional and the result carries
 *    what it could not find, so the screen shows "could not read the sire" and
 *    not a blank that looks like "no sire".
 * 3. **Nothing is written from this directly.** The caller previews it and the
 *    person hits save, which means a wrong parse costs a glance rather than a
 *    corrupted pedigree.
 *
 * The three sites are one application on three hostnames, and the hostname is
 * what says which association's numbers these are.
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
 * and a registration number is only meaningful next to the registry that issued
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

/* -------------------------------------------------------------- the parse */

export interface ImportedAncestor {
  readonly name?: string | undefined;
  readonly regNumber?: string | undefined;
  /** Generations above the subject. 1 is a parent. */
  readonly generation: number;
  /** "sire", "dam", "sire's sire" — the path, in the words a breeder uses. */
  readonly position: string;
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
  readonly breedComposition: readonly { breed: string; percent: number }[];
  readonly ancestors: readonly ImportedAncestor[];
  /** Field names the parser looked for and could not find. */
  readonly missing: readonly string[];
}

/** Strip tags and collapse whitespace — the page is HTML and we want the words. */
function textOf(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|div|p|table|li)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/**
 * The value sitting next to a label.
 *
 * Digital Beef lays its detail out as label-then-value, whether that is two
 * cells of a table or two runs of text, so both collapse to the same thing
 * once the tags are gone: the label, a separator, and the value up to the end
 * of the line. The separator is a tab (a former table cell), a colon, or
 * simply whitespace.
 */
function valueAfterLabel(text: string, labels: readonly string[]): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(
      `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\t]?\\s*([^\\n\\t]+)`,
      "i",
    );
    const found = pattern.exec(text);
    const value = found?.[1]?.trim();
    if (value !== undefined && value !== "" && value !== "-") return value;
  }
  return undefined;
}

/**
 * Breed composition, as Digital Beef writes it.
 *
 * Two spellings in the wild — "50% MA 25% CH 25% SH" and "1/2 MA 1/4 CH", so
 * both are read. Fractions convert; percentages pass through. A composition
 * that does not reach 100 is returned as it was found rather than corrected,
 * because the correction would be a guess about which share was misread.
 */
export function parseComposition(value: string): { breed: string; percent: number }[] {
  const shares: { breed: string; percent: number }[] = [];

  const percentPattern = /(\d{1,3}(?:\.\d+)?)\s*%\s*([A-Za-z][A-Za-z\- ]{0,29}?)(?=\s|$|\d)/g;
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
  return shares;
}

/**
 * The positions in a three-generation pedigree, in the order the page lists
 * them — sire's side first, then dam's, depth-first, which is how every
 * pedigree chart ever printed is laid out.
 */
const PEDIGREE_POSITIONS: readonly { position: string; generation: number }[] = [
  { position: "sire", generation: 1 },
  { position: "sire's sire", generation: 2 },
  { position: "sire's sire's sire", generation: 3 },
  { position: "sire's sire's dam", generation: 3 },
  { position: "sire's dam", generation: 2 },
  { position: "sire's dam's sire", generation: 3 },
  { position: "sire's dam's dam", generation: 3 },
  { position: "dam", generation: 1 },
  { position: "dam's sire", generation: 2 },
  { position: "dam's sire's sire", generation: 3 },
  { position: "dam's sire's dam", generation: 3 },
  { position: "dam's dam", generation: 2 },
  { position: "dam's dam's sire", generation: 3 },
  { position: "dam's dam's dam", generation: 3 },
];

/**
 * A registration number as these three registries print one.
 *
 * Six to nine digits, optionally with a letter prefix. Deliberately loose: the
 * number is shown to a person before anything is saved, and a pattern tight
 * enough to reject a real number would lose an ancestor silently.
 */
const REGISTRATION = /\b([A-Z]{0,3}\d{5,9})\b/;

/**
 * Pull the pedigree block out.
 *
 * The chart is the run of the page between the word "Pedigree" and whatever
 * section follows it — EPDs, ownership, progeny. Each ancestor is a name and a
 * registration number on one line or two adjacent ones, and they appear in
 * chart order, which is what lets them be assigned to positions by sequence.
 *
 * Sequence rather than structure, because the structure is a nest of tables
 * with rowspans that no amount of regular expression will survive. If the
 * count does not match a 3-generation chart, the extras are dropped and the
 * shortfall is reported rather than shifting everything by one.
 */
export function parsePedigreeBlock(text: string): ImportedAncestor[] {
  const start = /pedigree/i.exec(text)?.index;
  const region = start === undefined ? text : text.slice(start);
  const end = /\b(epds?|ownership|progeny|performance|show results)\b/i.exec(region)?.index;
  const block = end === undefined ? region : region.slice(0, end);

  const found: { name?: string; regNumber?: string }[] = [];
  for (const line of block.split("\n").slice(1)) {
    const cleaned = line.replace(/\s+/g, " ").trim();
    if (cleaned === "") continue;

    const registration = REGISTRATION.exec(cleaned)?.[1];
    const name = cleaned
      .replace(REGISTRATION, "")
      .replace(/[|,;·]/g, " ")
      .trim();

    // A line with neither a number nor anything name-shaped is furniture.
    if (registration === undefined && name.length < 3) continue;
    if (registration === undefined && !/[A-Za-z]{3}/.test(name)) continue;

    found.push({
      ...(name === "" ? {} : { name }),
      ...(registration === undefined ? {} : { regNumber: registration }),
    });
  }

  return found.slice(0, PEDIGREE_POSITIONS.length).map((entry, index) => ({
    ...entry,
    position: PEDIGREE_POSITIONS[index]?.position ?? `ancestor ${index + 1}`,
    generation: PEDIGREE_POSITIONS[index]?.generation ?? 0,
  }));
}

/**
 * Read a whole animal page.
 *
 * Takes the HTML rather than a URL: fetching is somebody else's job (a browser
 * cannot fetch this cross-origin, so it goes through a server route), and
 * separating the two is what makes this testable against a saved page without
 * a network.
 */
export function parseDigitalBeefPage(
  html: string,
  ref: Pick<DigitalBeefRef, "association" | "registration"> & { url?: string },
): ImportedAnimal {
  const text = textOf(html);
  const missing: string[] = [];

  const take = (field: string, labels: readonly string[]): string | undefined => {
    const value = valueAfterLabel(text, labels);
    if (value === undefined) missing.push(field);
    return value;
  };

  const name = take("Registered name", ["Animal Name", "Name"]);
  const tattoo = take("Tattoo", ["Tattoo"]);
  const sex = take("Sex", ["Sex", "Gender"]);
  const dob = take("Date of birth", ["Birth Date", "DOB", "Date of Birth"]);
  const colour = take("Colour", ["Color", "Colour"]);
  const hornStatus = take("Horn status", ["Horn Status", "Polled", "Horned"]);
  const compositionRaw = valueAfterLabel(text, ["Breed Composition", "Percentage", "Breed"]);

  const ancestors = parsePedigreeBlock(text);
  if (ancestors.length === 0) missing.push("Pedigree");

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
    breedComposition: compositionRaw === undefined ? [] : parseComposition(compositionRaw),
    ancestors,
    missing,
  };
}

/** Every association this importer knows how to file numbers under. */
export const IMPORTABLE_ASSOCIATIONS: readonly Association[] = ASSOCIATIONS.filter(
  (association): association is Association =>
    Object.values(HOST_ASSOCIATIONS).includes(association),
);
