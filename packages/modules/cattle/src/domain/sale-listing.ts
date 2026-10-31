import { fromDollars, type Money, type Ulid } from "@galaxy-farm/core";

import type { ParentRef } from "./cattle-profile.js";
import type { CattleCandidateDetail } from "./cattle-candidate.js";
import { listedSex, listingNamesBreed, type ListedSex } from "./sale-watch.js";

/**
 * One SC listing, turned into what the candidate list stores (spec §5.2).
 *
 * The listing says a lot of things and most of them are the seller's words:
 * a sire written "Coping Wtih Destiny", a registration number printed under
 * one association's name and not another's. This module reads them into
 * fields the app can rely on and keeps the rest as the seller wrote it. It
 * never guesses a parent or a herdbook it cannot back up, because a pedigree
 * that is confidently wrong is worse than one that says "not matched".
 */

/** Label → value pairs from a listing's details, as the sale page prints them. */
export type ListingFields = Readonly<Record<string, string>>;

/** An animal the app already knows, which a listed parent might be. */
export interface CatalogEntry {
  readonly kind: "animal" | "external";
  readonly id: Ulid;
  /** Every name the animal goes by: herd name, registered name, any spelling on file. */
  readonly names: readonly string[];
}

/**
 * The breeds a registration can be filed under. Each is a herdbook the app
 * already names (`REGISTRIES`), except Simmental, which has no entry there yet:
 * its `ASA` code collides with Shorthorn's legacy code, so filing it is a
 * decision, not a default. Until then a Simmental registration is read and
 * kept under the association name `Simmental`.
 */
const HERDBOOK_BREEDS = ["Maine-Anjou", "Chianina", "Shorthorn", "Angus", "Simmental"] as const;

const STOP_WORDS = new Set(["x", "by", "and", "the", "et"]);

/** A name as word tokens: lower case, parentheticals and punctuation dropped, stop words out. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

/**
 * Two names share enough words to be the same animal: at least two shared
 * words, and most of the shorter name. "Coping Wtih Destiny" shares two words
 * with "TJSC COPING WITH DESTINY 9K", which is enough to be worth a look and
 * not enough to be sure, so it is only taken when nothing matches exactly.
 */
function sharesEnoughWords(a: readonly string[], b: readonly string[]): boolean {
  const shared = new Set(a.filter((token) => b.includes(token))).size;
  return shared >= 2 && shared / Math.min(new Set(a).size, new Set(b).size) >= 0.6;
}

/**
 * Find the catalog animal a listed parent is, if there is exactly one.
 *
 * An exact name match wins outright. Otherwise a fuzzy match is taken only when
 * it is the only one. Two candidates for one parent is no match at all: the
 * pedigree shows the name the listing used, and the match is left for a person.
 */
export function matchCatalogParent(
  listedName: string | undefined,
  catalog: readonly CatalogEntry[],
): ParentRef | undefined {
  if (listedName === undefined) return undefined;
  const wanted = nameTokens(listedName);
  if (wanted.length === 0) return undefined;
  const wantedKey = wanted.join(" ");

  const exact: CatalogEntry[] = [];
  const fuzzy: CatalogEntry[] = [];
  for (const entry of catalog) {
    const names = entry.names.map(nameTokens).filter((tokens) => tokens.length > 0);
    if (names.some((tokens) => tokens.join(" ") === wantedKey)) {
      exact.push(entry);
    } else if (names.some((tokens) => sharesEnoughWords(wanted, tokens))) {
      fuzzy.push(entry);
    }
  }

  const picks = exact.length > 0 ? exact : fuzzy;
  const [only] = picks;
  return picks.length === 1 && only !== undefined ? { kind: only.kind, id: only.id } : undefined;
}

/** The herdbook a listing's breed files under, when exactly one does. Crosses name two, so they get none. */
export function herdbookFor(breed: string | undefined): string | undefined {
  const matches = HERDBOOK_BREEDS.filter((name) => listingNamesBreed(name, breed));
  return matches.length === 1 ? matches[0] : undefined;
}

export interface ListedRegistration {
  readonly association: string;
  readonly regNumber: string;
}

/**
 * The registration number, if the listing prints one.
 *
 * The label varies by seller ("ASA Reg Number", "Reg #", "Registration
 * Number", "ASA Registration #"), and the association prefix on it is not
 * trusted: on a Simmental lot "ASA" is the American Simmental Association, and
 * on a Shorthorn lot it is the American Shorthorn Association. So the herdbook
 * comes from the breed, and a number with no herdbook behind it is not returned.
 */
export function registrationFromFields(
  fields: ListingFields,
  breed: string | undefined,
): ListedRegistration | undefined {
  const association = herdbookFor(breed);
  if (association === undefined) return undefined;

  for (const [label, value] of Object.entries(fields)) {
    if (!/\breg(?:istration)?\b/i.test(label) || /ranch\s*tag/i.test(label)) continue;
    const regNumber = value.replace(/\s+/g, "");
    if (/\d/.test(regNumber)) return { association, regNumber };
  }
  return undefined;
}

/** The sire and dam as the listing names them, or undefined where it names none. */
export function parentNamesFromFields(fields: ListingFields): { sire?: string; dam?: string } {
  const named = (label: string): string | undefined => {
    const entry = Object.entries(fields).find(([key]) => key.trim().toLowerCase() === label);
    const value = entry?.[1].trim();
    return value === undefined || value === "" || value === "-" ? undefined : value;
  };
  return { sire: named("sire"), dam: named("dam") };
}

/** The sex on the candidate, from the listing's Sex line. */
export function sexOfListing(text: string | undefined): CattleCandidateDetail["sex"] {
  const listed: ListedSex = listedSex(text);
  switch (listed) {
    case "bull":
      return "male";
    case "steer":
      return "steer";
    case "heifer_unspecified":
    case "open_heifer":
    case "bred_heifer":
    case "cow_unspecified":
    case "bred_cow":
      return "female";
    default:
      return "unknown";
  }
}

export interface SaleListingInput {
  readonly candidateId: Ulid;
  readonly sale: {
    readonly title: string;
    readonly location?: string | undefined;
    readonly endsAt?: Date | undefined;
  };
  readonly lot: {
    readonly lotNumber: string;
    readonly lotName: string;
    readonly lotUrl: string;
    /** The next bid is what it takes to get in, so it is the asking price. */
    readonly nextBid?: number | undefined;
    readonly pictureUrl?: string | undefined;
    readonly videoUrl?: string | undefined;
  };
  readonly fields: ListingFields;
  readonly catalog: readonly CatalogEntry[];
}

/** What a listing becomes on the candidate list, before it is saved. */
export interface ListedCandidate {
  readonly title: string;
  readonly askingPrice: Money;
  readonly location?: string | undefined;
  readonly listingUrl: string;
  readonly expiresAt?: Date | undefined;
  readonly domainDetail: CattleCandidateDetail;
}

/**
 * Map one lot to a candidate. A sale on SC is an auction, so the sale type is
 * always `auction`. The listing's own video and picture are kept as links: the
 * picture lives on SC's servers, so it can disappear after the sale.
 */
export function candidateFromListing(input: SaleListingInput): ListedCandidate {
  const { fields, lot, sale, catalog } = input;
  const breed = fields["Breed"];
  const registration = registrationFromFields(fields, breed);
  const parents = parentNamesFromFields(fields);
  const sex = sexOfListing(fields["Sex"]);
  const listed = listedSex(fields["Sex"]);
  const sire = matchCatalogParent(parents.sire, catalog);
  const dam = matchCatalogParent(parents.dam, catalog);

  return {
    title: `Lot ${lot.lotNumber}: ${lot.lotName.trim()}`,
    askingPrice: fromDollars(lot.nextBid ?? 0),
    location: sale.location,
    listingUrl: lot.lotUrl,
    expiresAt: sale.endsAt,
    domainDetail: {
      candidateId: input.candidateId,
      breedComposition: [],
      sex,
      bred: listed === "bred_heifer" || listed === "bred_cow",
      unpapered: false,
      association: registration?.association,
      regNumber: registration?.regNumber,
      sire,
      dam,
      sireName: parents.sire,
      damName: parents.dam,
      saleType: "auction",
      lotNumber: lot.lotNumber,
      saleName: sale.title,
      pictureUrl: lot.pictureUrl,
      videoUrl: lot.videoUrl,
      dobText: fields["DOB"],
      breedText: breed,
    },
  };
}
