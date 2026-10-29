import type { Animal, Ulid } from "@galaxy-farm/core";

/**
 * The bit of the URL that names a cow.
 *
 * `/admin/cattle/01ARZ3NDEKTSV4RRFFQ69G5FP1` is a correct URL and a useless
 * one. Nobody can read it, nobody can type it, and nobody can tell from a
 * browser history which cow they were looking at. So the segment is what the
 * animal is actually called on the place: her tag, or her registration, or her
 * name.
 *
 * The id stays the identity — everything stored points at it — and this is
 * only an address. That distinction is what makes it safe for the slug to
 * change when a cow is finally tagged: the records do not move, the URL does,
 * and the old one still resolves through the fallback below.
 */

/** What a slug is allowed to contain: lowercase, digits, and single dashes. */
export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      // Strip accents rather than percent-encoding them into an unreadable URL.
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

export interface Sluggable {
  readonly id: Ulid;
  readonly tagNumber?: string | undefined;
  readonly name?: string | undefined;
}

/**
 * Preference order: tag, then registration, then name.
 *
 * The tag first because it is the thing written on the animal and the thing
 * two people will agree on. A name is what she is called; a tag is what she
 * is. Registration sits between them — it is authoritative but nobody says it
 * out loud.
 */
export function animalSlug(
  animal: Sluggable,
  registrationNumber?: string,
  reserved: ReadonlySet<string> = NOTHING_RESERVED,
): string {
  const candidates = [animal.tagNumber, registrationNumber, animal.name];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const slug = slugify(candidate);
    if (slug === "") continue;
    // A horse called "Herd" would be `/admin/horses/herd`, which is the herd
    // list: Next serves a fixed segment before a dynamic one, so the page for
    // her would never be reached. Such a name keeps its word and gains one.
    return reserved.has(slug) ? `${slug}-${RESERVED_SUFFIX}` : slug;
  }

  // Nothing readable to use. The id is a poor address but it is always an
  // address, and `animalSchema` already refuses a record with neither a name
  // nor a tag, so this is close to unreachable.
  return animal.id.toLowerCase();
}

const NOTHING_RESERVED: ReadonlySet<string> = new Set();

/** What a slug that collides with a section route gets on the end. */
const RESERVED_SUFFIX = "animal";

export interface SlugResolution<T> {
  readonly animal: T;
  /** True when the URL used a slug this animal no longer answers to. */
  readonly stale: boolean;
}

/**
 * Find the animal a URL segment refers to.
 *
 * Four passes, narrowing: its current slug, its id, its tag, its name. The
 * later passes are what make an old bookmark keep working after a rename —
 * losing a link because somebody corrected a spelling is the kind of small
 * betrayal that stops people trusting the app with anything.
 *
 * Ambiguity resolves to the earliest-created match rather than an error. Two
 * cows called "Red" is a data problem to fix on the herd screen, not a reason
 * to refuse to show either of them.
 */
export function resolveAnimalSlug<T extends Sluggable>(
  segment: string,
  animals: readonly T[],
  registrationFor: (animal: T) => string | undefined = () => undefined,
  reserved: ReadonlySet<string> = NOTHING_RESERVED,
): SlugResolution<T> | undefined {
  const wanted = slugify(decodeURIComponent(segment));
  if (wanted === "") return undefined;

  const byCreation = [...animals].sort((left, right) => left.id.localeCompare(right.id));

  const current = byCreation.find(
    (animal) => animalSlug(animal, registrationFor(animal), reserved) === wanted,
  );
  if (current !== undefined) return { animal: current, stale: false };

  const byId = byCreation.find((animal) => animal.id.toLowerCase() === wanted);
  if (byId !== undefined) return { animal: byId, stale: true };

  const byTag = byCreation.find(
    (animal) => animal.tagNumber !== undefined && slugify(animal.tagNumber) === wanted,
  );
  if (byTag !== undefined) return { animal: byTag, stale: true };

  const byName = byCreation.find(
    (animal) => animal.name !== undefined && slugify(animal.name) === wanted,
  );
  if (byName !== undefined) return { animal: byName, stale: true };

  const byRegistration = byCreation.find((animal) => {
    const registration = registrationFor(animal);
    return registration !== undefined && slugify(registration) === wanted;
  });
  return byRegistration === undefined ? undefined : { animal: byRegistration, stale: true };
}

/** Where a cow lives, for a link. */
export function animalHref(animal: Sluggable, registrationNumber?: string): string {
  return `/admin/cattle/${animalSlug(animal, registrationNumber, CATTLE_SECTION_SEGMENTS)}`;
}

/**
 * The fixed routes beside each species' record pages (spec §7).
 *
 * A record page is `/admin/<species>/<slug>`, and its section's own views sit
 * at the same depth. Next resolves a fixed segment first, so a horse whose slug
 * were `pens` would open the pens board instead of her page. These are the
 * words a slug must step around; `tests/animal-slug.test.ts` checks them
 * against the folders on disk, so a new view cannot be added without them.
 *
 * Cattle steps around its own views the same way. Only a cow whose slug *was*
 * one of these words moves — and her old address opened the view instead of
 * her, so no bookmark that worked stops working.
 */
export const CATTLE_SECTION_SEGMENTS: ReadonlySet<string> = new Set([
  "ancestors",
  "breeding",
  "calving",
  "candidates",
  "catalog",
  "feed",
  "health",
  "risks",
  "roadmap",
  "sales",
  "supplies",
  "weights",
]);

export const HORSE_SECTION_SEGMENTS: ReadonlySet<string> = new Set([
  "herd",
  "pens",
  "feeding",
  "breeding",
  "roadmap",
  "candidates",
]);

/** Pets have no views of their own yet; kept so a future one has a home. */
export const PET_SECTION_SEGMENTS: ReadonlySet<string> = new Set();

/** A pet's address segment — the same preference order, minus its section's words. */
export function petSlug(animal: Sluggable): string {
  return animalSlug(animal, undefined, PET_SECTION_SEGMENTS);
}

/** A horse's address segment, stepping around the horse section's own views. */
export function horseSlug(animal: Sluggable): string {
  return animalSlug(animal, undefined, HORSE_SECTION_SEGMENTS);
}

/** Where a dog or a cat lives, for a link: `/admin/pets/<slug>`. */
export function petHref(animal: Sluggable): string {
  return `/admin/pets/${petSlug(animal)}`;
}

/** Where a horse lives, for a link: `/admin/horses/<slug>`. */
export function horseHref(animal: Sluggable): string {
  return `/admin/horses/${horseSlug(animal)}`;
}

/** Two animals resolving to one slug — worth telling somebody about. */
export function duplicateSlugs<T extends Sluggable>(
  animals: readonly T[],
  registrationFor: (animal: T) => string | undefined = () => undefined,
): Map<string, T[]> {
  const bySlug = new Map<string, T[]>();

  for (const animal of animals) {
    const slug = animalSlug(animal, registrationFor(animal));
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), animal]);
  }

  return new Map([...bySlug].filter(([, matches]) => matches.length > 1));
}

/** Narrowing helper for the display name, so a card never renders "undefined". */
export function animalTitle(animal: Pick<Animal, "name" | "tagNumber">): string {
  if (animal.name !== undefined && animal.name !== "") return animal.name;
  if (animal.tagNumber !== undefined && animal.tagNumber !== "") return `Tag ${animal.tagNumber}`;
  return "Unnamed";
}
