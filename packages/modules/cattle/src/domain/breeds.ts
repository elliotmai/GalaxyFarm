import type { BreedShare } from "./cattle-profile.js";

/**
 * What breed is this animal? (spec §5.2)
 *
 * A crossbred animal has no single answer, which is why this is a list. A
 * Maine-Anjou bull out of an Angus cow is both, and a record that has to pick
 * one picks wrong every time — the herd list wants to show "Maine-Anjou ·
 * Angus", not "Maine-Anjou" with the other half quietly dropped.
 *
 * This is deliberately *not* the breed makeup. The makeup is percentages, it
 * has to add to a hundred, and it is what the papers state. The breed is what
 * a person would say standing at the fence, and most of this farm's cattle
 * have one long before anybody has papers to work a percentage out of.
 *
 * The two are kept in step by derivation rather than by discipline: an animal
 * with a makeup and no breed on file gets its breeds *from* the makeup, so the
 * two cannot disagree unless somebody deliberately overrides it. And an
 * override is a real thing to want — a commercial cow bought as "black baldy"
 * has a breed and will never have a makeup.
 */

/**
 * The codes the associations print, spelled out.
 *
 * Only codes seen on real pages are here. An unknown code is shown as itself
 * rather than guessed at: `XX` on a Chianina makeup means the association does
 * not know either, and inventing a breed for it would be putting words in a
 * registry's mouth.
 */
export const BREED_NAMES: Record<string, string> = {
  MA: "Maine-Anjou",
  CA: "Chianina",
  CH: "Chianina",
  CHIA: "Chianina",
  SH: "Shorthorn",
  AN: "Angus",
  RA: "Red Angus",
  HH: "Hereford",
  PH: "Polled Hereford",
  SM: "Simmental",
  LM: "Limousin",
  CS: "Charolais",
  GV: "Gelbvieh",
  BM: "Brahman",
  XX: "Unrecorded",
};

/** A code or a name, as a name. Anything unrecognised comes back as it went in. */
export function breedName(code: string): string {
  const trimmed = code.trim();
  return BREED_NAMES[trimmed.toUpperCase()] ?? trimmed;
}

/**
 * Shares below this are not what anybody means by "the breed".
 *
 * A bull who is 79% Maine, 14% Angus and 2.3% unrecorded is a Maine-Angus.
 * Listing the 2.3% makes the field unreadable on a list screen and tells
 * nobody anything the makeup does not already say better.
 */
const WORTH_NAMING = 5;

/**
 * The breeds a makeup amounts to, biggest share first.
 *
 * Everything at or over five percent, and if that would leave nothing at all —
 * a genuinely fragmented makeup — the largest share alone, because "no breed"
 * is a worse answer than "mostly this".
 */
export function breedsFromComposition(composition: readonly BreedShare[]): string[] {
  const byShare = [...composition]
    .filter((share) => share.percent > 0)
    .sort((left, right) => right.percent - left.percent);

  const worth = byShare.filter((share) => share.percent >= WORTH_NAMING);
  const chosen = worth.length > 0 ? worth : byShare.slice(0, 1);

  const named: string[] = [];
  for (const share of chosen) {
    const name = breedName(share.breed);
    // `CA` and `CH` are both Chianina, and a makeup carrying both should not
    // list it twice.
    if (name !== "Unrecorded" && !named.includes(name)) named.push(name);
  }
  return named;
}

/**
 * What to call this animal's breed, however much is known.
 *
 * What somebody typed wins. A person who wrote "Black Baldy" on a commercial
 * cow meant it, and recomputing that from an eighth of a pedigree would be
 * this app telling the owner what is standing in his own pasture.
 */
export function breedsOf(animal: {
  readonly breed?: readonly string[] | undefined;
  readonly breedComposition?: readonly BreedShare[] | undefined;
}): string[] {
  const stated = (animal.breed ?? []).map((entry) => entry.trim()).filter((entry) => entry !== "");
  if (stated.length > 0) return stated;

  return breedsFromComposition(animal.breedComposition ?? []);
}

/** One line for a list or a pill row. Empty when nothing is known. */
export function describeBreed(animal: Parameters<typeof breedsOf>[0]): string {
  return breedsOf(animal).join(" · ");
}

/**
 * Every breed anywhere in a herd, for a filter's dropdown.
 *
 * Sorted by how many animals carry it and then alphabetically, so the breeds
 * this farm actually runs come first and the one bought-in Hereford does not
 * sit at the top because of its initial.
 */
export function breedsInUse(animals: readonly Parameters<typeof breedsOf>[0][]): string[] {
  const counts = new Map<string, number>();
  for (const animal of animals) {
    for (const breed of breedsOf(animal)) {
      counts.set(breed, (counts.get(breed) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([leftName, left], [rightName, right]) =>
      left === right ? leftName.localeCompare(rightName) : right - left,
    )
    .map(([name]) => name);
}
