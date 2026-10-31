import { z } from "zod";

import { ulidSchema } from "@galaxy-farm/core";

/**
 * A standing search over the sales on SC (spec §5.2, §5.1 — the wishlist made
 * specific enough to watch).
 *
 * Each watch says what you would take home: sexes, breeds, or both. A cattle
 * listing that satisfies a watch becomes a CattleCandidate, and the candidate
 * list is the running list. Empty lists mean "any": a watch with no breeds
 * takes every breed, and a watch with no sexes takes every sex.
 *
 * Matching is deliberately loose on breed. A breed criterion matches any
 * listing that names the breed, including crosses and percentages, so
 * "Simmental" finds "1/2 Simmental", "PB Simmental" and "Chi, Percentage
 * Simmental" alike. Someone shopping for Simmental wants those too, and the
 * composition is on the candidate for when they do not.
 */

/** What a watch can ask for. `heifer` and `cow` are umbrellas over the bred and open forms. */
export const SALE_WATCH_SEXES = [
  "heifer",
  "open_heifer",
  "bred_heifer",
  "cow",
  "bred_cow",
  "steer",
  "bull",
] as const;
export type SaleWatchSex = (typeof SALE_WATCH_SEXES)[number];

/** What a listing's Sex line says, once read. */
export type ListedSex =
  Exclude<SaleWatchSex, "heifer" | "cow"> | "heifer_unspecified" | "cow_unspecified" | "unknown";

export const saleWatchSchema = z.object({
  watchId: ulidSchema,
  name: z.string().trim().min(1, "Name this watch").max(80),
  /** Empty means any sex. */
  sexes: z.array(z.enum(SALE_WATCH_SEXES)).max(SALE_WATCH_SEXES.length).default([]),
  /** Breed names as the app spells them (`BREEDS`), or free text for anything else. Empty means any breed. */
  breeds: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  /** A paused watch keeps its settings and stops matching. */
  enabled: z.boolean().default(true),
});
export type SaleWatch = z.infer<typeof saleWatchSchema>;

/** One listing, as far as a watch cares. Sex and breed come straight off the lot page. */
export interface ListedLot {
  readonly sex?: string | undefined;
  readonly breed?: string | undefined;
}

/**
 * Read a listing's Sex line.
 *
 * Bred is checked before open and both before the bare word, so "Bred Heifer"
 * is not read as a heifer of no particular kind. A missing or unreadable line
 * is `unknown`, and an unknown sex matches only a watch that names no sex.
 */
export function listedSex(text: string | undefined): ListedSex {
  const value = (text ?? "").toLowerCase();
  if (/\bbred\s+heifer/.test(value)) return "bred_heifer";
  if (/\bopen\s+heifer/.test(value)) return "open_heifer";
  if (/\bheifer/.test(value)) return "heifer_unspecified";
  if (/\bbred\s+cow/.test(value)) return "bred_cow";
  if (/\bcow/.test(value)) return "cow_unspecified";
  if (/\bsteer/.test(value)) return "steer";
  if (/\bbull/.test(value)) return "bull";
  return "unknown";
}

/**
 * Whether one listed sex satisfies one criterion.
 *
 * `heifer` takes any heifer, `cow` takes any cow, and every other criterion
 * is exact. A listing that says only "Heifer" satisfies `heifer` but not
 * `open_heifer`, because the listing did not say it was open.
 */
export function sexSatisfies(criterion: SaleWatchSex, listed: ListedSex): boolean {
  switch (criterion) {
    case "heifer":
      return (
        listed === "heifer_unspecified" || listed === "open_heifer" || listed === "bred_heifer"
      );
    case "cow":
      return listed === "cow_unspecified" || listed === "bred_cow";
    default:
      return listed === criterion;
  }
}

/**
 * How each breed a watch can name shows up in a listing's Breed line.
 *
 * The canonical six get a pattern each, because their listings spell them every
 * way: "Maintainer", "Mainetainer" and "Maine-Angus" all carry Maine-Anjou
 * blood; "Chi" is how most listings write Chianina. Any other breed matches by
 * its own name, case-insensitively, as a whole word.
 */
const BREED_PATTERNS: Readonly<Record<string, RegExp>> = {
  "Maine-Anjou": /\bmaine(?:tainer)?\b|\bmaintainer\b|\bmaine[-\s]anjou\b/i,
  Chianina: /\bchi\b|\bchianina\b/i,
  Shorthorn: /\bshorthorn\b|\bsh\b/i,
  Simmental: /\bsimmental\b/i,
  Angus: /\bangus\b/i,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function breedPattern(breed: string): RegExp {
  return BREED_PATTERNS[breed] ?? new RegExp(`\\b${escapeRegExp(breed)}\\b`, "i");
}

/** Whether a listing's Breed line names this breed, crosses and percentages included. */
export function listingNamesBreed(breed: string, listed: string | undefined): boolean {
  return listed !== undefined && breedPattern(breed).test(listed);
}

/**
 * Whether a listing satisfies a watch.
 *
 * A disabled watch matches nothing. Otherwise the listing must satisfy at least
 * one sex (or the watch names none) and at least one breed (or the watch names
 * none). A listing with no Breed line cannot satisfy a breed criterion.
 */
export function matchesSaleWatch(watch: SaleWatch, lot: ListedLot): boolean {
  if (!watch.enabled) return false;

  const listed = listedSex(lot.sex);
  const sexOk =
    watch.sexes.length === 0 || watch.sexes.some((criterion) => sexSatisfies(criterion, listed));
  if (!sexOk) return false;

  return (
    watch.breeds.length === 0 || watch.breeds.some((breed) => listingNamesBreed(breed, lot.breed))
  );
}
