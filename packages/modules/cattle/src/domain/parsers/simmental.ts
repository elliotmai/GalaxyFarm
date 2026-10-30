import { fieldValue } from "./digital-beef.js";
import { escape, textOf, type ImportedAncestor, type ImportedAnimal } from "./page.js";

/**
 * Simmental — the American Simmental Association's own herdbook (spec §5.2).
 *
 * Not Digital Beef. The ASA runs its herdbook on its own site, `herdbook.org`,
 * and its animal page is laid out differently from the three templates in
 * `digital-beef.ts`, so it has its own reader. What it shares with them is the
 * shape of the answer: `ImportedAnimal`, the same as every other association.
 *
 * **The number is in the page, not the address.** The template address
 * (`.../animalSearch,IndividualAnimal.vm`) names no animal. The registration is
 * read from `ASA #`, and an address that carries an animal number — `/animal/N`
 * or `animalNumber=N` — is accepted too, so the two can be checked against each
 * other.
 *
 * **Pedigree is a three-generation chart with the animal in the middle.** Six
 * ancestors and the subject, written as seven rows: the sire's half above, the
 * dam's half below. The sire is the middle row of the top three, and the dam is
 * the middle row of the bottom three. A chart with any other shape is not
 * guessed at — every ancestor is kept as unplaced, because a wrong guess puts an
 * animal on the wrong side of the pedigree.
 *
 * **Colour codes are not decoded.** The chart's `BB` and `B` are the ASA's own
 * colour codes, not colour names, and a code guessed into a word would be
 * wrong on the page that matters. They are left off rather than mistranslated.
 */

export const SIMMENTAL_ASSOCIATION = "Simmental";
export const SIMMENTAL_HOST = "herdbook.org";

/** The sexes the ASA prints as the last word of its status line. */
const SEXES = ["Bull", "Cow", "Heifer", "Steer"] as const;

export interface SimmentalRef {
  readonly url: string;
  readonly host: string;
  readonly association: typeof SIMMENTAL_ASSOCIATION;
  readonly registration: string;
}

/**
 * Pull the animal's number out of an ASA address, or say why not.
 *
 * Refuses the search template by name. That address is the page a person
 * lands on before they have chosen an animal, and reading it would produce an
 * empty animal filed under no number at all.
 */
export function parseSimmentalUrl(
  input: string,
): { ok: true; ref: SimmentalRef } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "That is not a web address." };
  }

  const host = url.hostname.toLowerCase();
  if (host !== SIMMENTAL_HOST && host !== `www.${SIMMENTAL_HOST}`) {
    return { ok: false, reason: `${host} is not the American Simmental herdbook.` };
  }

  const fromPath = /\/animal\/(\d+)/.exec(url.pathname)?.[1];
  const fromQuery = url.searchParams.get("animalNumber") ?? undefined;
  const registration = fromPath ?? fromQuery;
  if (registration === undefined) {
    return {
      ok: false,
      reason:
        "That is the herdbook's search page, not an animal's. Open the animal and copy the address from there, or paste the animal's page.",
    };
  }

  return {
    ok: true,
    ref: { url: url.toString(), host, association: SIMMENTAL_ASSOCIATION, registration },
  };
}

/** The text of the cell that follows a label, with its markup stripped. */
function cellAfter(html: string, label: string): string | undefined {
  const cell = new RegExp(
    `${escape(label)}:?\\s*</(?:strong|span|b)>\\s*(?::\\s*)?(?:</div>)?\\s*<div[^>]*>([\\s\\S]*?)</div>`,
  ).exec(html);
  if (cell === null) return undefined;
  const value = (cell[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value === "" ? undefined : value;
}

interface ChartEntry {
  readonly name: string;
  readonly regNumber?: string | undefined;
}

/** Every row of the pedigree chart, in the order it is printed, subject included. */
function chartRows(html: string): { entry?: ChartEntry; isSubject: boolean }[] {
  const rows: { entry?: ChartEntry; isSubject: boolean }[] = [];
  for (const row of html.matchAll(/<div class="(pedone|pedtwo|pedzero)"[^>]*>([\s\S]*?)<\/div>/g)) {
    const body = row[2] ?? "";
    const name = /class="pedAnmName[^"]*">([^<]*)</.exec(body)?.[1]?.trim();
    const regNumber = /class="number"[^>]*>\s*(\d+)\s*</.exec(body)?.[1];
    rows.push({
      isSubject: row[1] === "pedzero",
      ...(name === undefined || name === ""
        ? {}
        : { entry: { name, ...(regNumber === undefined ? {} : { regNumber }) } }),
    });
  }
  return rows;
}

const ANCESTOR_POSITIONS = {
  sire: ["sire's sire", "sire", "sire's dam"],
  dam: ["dam's sire", "dam", "dam's dam"],
} as const;

/**
 * Place the chart's ancestors. Any shape other than three rows above and three
 * below the subject leaves every ancestor unplaced rather than guessing.
 */
function placeChart(html: string): { placed: ImportedAncestor[]; unplaced: ImportedAncestor[] } {
  const rows = chartRows(html);
  const subjectAt = rows.findIndex((row) => row.isSubject);
  const above = subjectAt < 0 ? [] : rows.slice(0, subjectAt);
  const below = subjectAt < 0 ? [] : rows.slice(subjectAt + 1);
  const all = rows.flatMap((row) => (row.entry === undefined ? [] : [row.entry]));

  const toAncestor = (entry: ChartEntry, position: string | undefined, branch: string) => ({
    name: entry.name,
    ...(entry.regNumber === undefined ? {} : { regNumber: entry.regNumber }),
    geneticTests: [],
    branch,
    ...(position === undefined
      ? {}
      : { position, generation: position.split("'").length === 1 ? 1 : 2 }),
  });

  // Counted in rows, not names: a blank row is an ancestor nobody recorded,
  // and it still holds its slot.
  const regular = above.length === 3 && below.length === 3;
  if (!regular) {
    return { placed: [], unplaced: all.map((entry) => toAncestor(entry, undefined, "unplaced")) };
  }

  const placed: ImportedAncestor[] = [];
  for (const [side, block] of [
    ["sire", above],
    ["dam", below],
  ] as const) {
    block.forEach((row, index) => {
      if (row.entry === undefined) return;
      placed.push(toAncestor(row.entry, ANCESTOR_POSITIONS[side][index], side));
    });
  }
  return { placed, unplaced: [] };
}

/** Read an ASA animal page. Takes the page HTML, as every reader here does. */
export function parseSimmentalPage(
  html: string,
  ref: Pick<SimmentalRef, "registration"> & { url?: string },
): ImportedAnimal {
  const missing: string[] = [];
  const text = textOf(html);

  const shownNumber = /ASA #<\/strong>:\s*<a[^>]*>\s*(\d+)\s*<\/a>/.exec(html)?.[1];
  const registration = ref.registration || shownNumber;
  if (registration === undefined) missing.push("Registration");

  const name = /<big>([^<]+)<\/big>/.exec(html)?.[1]?.trim();
  if (name === undefined) missing.push("Registered name");

  // The colour and the horn status sit in the first column, one span each.
  const firstColumn = /class="ca g-2"([\s\S]*?)class="ra g-3"/.exec(html)?.[1] ?? "";
  const [colour, horn] = [...firstColumn.matchAll(/<span>([^<]*?)\s*<span class="xsm/g)].map(
    (match) => match[1]?.trim() || undefined,
  );
  if (colour === undefined) missing.push("Colour");
  if (horn === undefined) missing.push("Horn status");

  const tattoo = fieldValue(text, ["Tattoo"]);
  if (tattoo === undefined) missing.push("Tattoo");

  // `Frozen Embryo Bull` — a status, then the sex, on one line.
  const statusLine = /<div class="sex">\s*([^<]*?)\s*<\/div>/.exec(html)?.[1];
  const words = statusLine?.split(/\s+/) ?? [];
  const lastWord = words[words.length - 1];
  const sex =
    lastWord !== undefined && (SEXES as readonly string[]).includes(lastWord)
      ? lastWord
      : undefined;
  const status = sex === undefined ? statusLine : words.slice(0, -1).join(" ") || undefined;
  if (sex === undefined) missing.push("Sex");

  // `PB SM` — the class the papers state, kept as printed, as every reader does.
  const classification = /<div class="breed">\s*<span>([^<]*?)<\/span>/.exec(html)?.[1]?.trim();
  if (classification === undefined) missing.push("Class");

  const dob = cellAfter(html, "Birth Date");
  if (dob === undefined) missing.push("Date of birth");
  const breeder = cellAfter(html, "Breeder");
  const owner = cellAfter(html, "Owner");

  const { placed, unplaced } = placeChart(html);
  if (placed.length === 0 && unplaced.length === 0) missing.push("Pedigree");

  // The breed makeup is not on the animal page. Stated, not inferred.
  missing.push("Breed makeup");

  const parentOf = (position: "sire" | "dam") => {
    const found = placed.find((ancestor) => ancestor.position === position);
    if (found === undefined) return undefined;
    return {
      ...(found.regNumber === undefined ? {} : { regNumber: found.regNumber }),
      ...(found.name === undefined ? {} : { name: found.name }),
    };
  };

  return {
    association: SIMMENTAL_ASSOCIATION,
    registration: registration ?? "",
    ...(ref.url === undefined ? {} : { sourceUrl: ref.url }),
    ...(name === undefined ? {} : { name }),
    ...(tattoo === undefined ? {} : { tattoo }),
    ...(sex === undefined ? {} : { sex }),
    ...(dob === undefined ? {} : { dob }),
    ...(colour === undefined ? {} : { colour }),
    ...(horn === undefined ? {} : { hornStatus: horn }),
    ...(status === undefined || status === "" ? {} : { status }),
    ...(breeder === undefined ? {} : { breeder }),
    ...(owner === undefined ? {} : { owner }),
    ...(classification === undefined ? {} : { classification }),
    ...(parentOf("sire") === undefined ? {} : { sire: parentOf("sire") }),
    ...(parentOf("dam") === undefined ? {} : { dam: parentOf("dam") }),
    breedComposition: [],
    ancestors: placed,
    unplacedAncestors: unplaced,
    missing,
  };
}
