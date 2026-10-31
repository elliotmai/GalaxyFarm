import { isOnFarm, openAssignments, type Animal, type ZoneAssignment } from "@galaxy-farm/core";
import type { Flock } from "@galaxy-farm/module-poultry";

import { slugify } from "@/lib/animal-slug";

/**
 * The bit of the URL that names a flock (spec §7 `/admin/chickens/flock/[id]`).
 *
 * The cattle rule, for birds: the segment is what the flock is called on the
 * place — "the big coop" is `/admin/chickens/flock/the-big-coop` — and the id
 * is only the fallback. The id stays the identity; this is an address, so a
 * renamed flock moves its URL and the old one still resolves by id.
 *
 * A flock has no tag, so its name is the only readable candidate. Two flocks
 * that slug the same — "Bantams" and "bantams!" — would share an address, so
 * when the list is given the later one takes its id instead. Earliest-created
 * keeps the name, which is the same tie-break the herd uses.
 */

const BASE = "/admin/chickens/flock";

type Named = Pick<Flock, "id" | "name">;

/** The segment for one flock, made unique against `flocks` when they are given. */
export function flockSlug(flock: Named, flocks: readonly Named[] = []): string {
  const slug = slugify(flock.name);
  if (slug === "") return flock.id.toLowerCase();

  const earlier = flocks.some(
    (other) => other.id !== flock.id && slugify(other.name) === slug && other.id < flock.id,
  );
  return earlier ? flock.id.toLowerCase() : slug;
}

/**
 * Where a flock's own page is, for a link.
 *
 * Pass every flock on the property when you have them, so two flocks with the
 * same name never point at the same page.
 */
export function flockHref(flock: Named, flocks: readonly Named[] = []): string {
  return `${BASE}/${flockSlug(flock, flocks)}`;
}

export interface FlockResolution<T> {
  readonly flock: T;
  /** True when the URL used something other than the flock's current slug. */
  readonly stale: boolean;
}

/**
 * Find the flock a URL segment refers to: its current slug, then its id.
 *
 * The id pass is what keeps an old link working after a rename, and what
 * answers for the second of two flocks that share a name.
 */
export function resolveFlockSlug<T extends Named>(
  segment: string,
  flocks: readonly T[],
): FlockResolution<T> | undefined {
  const wanted = decodeURIComponent(segment).toLowerCase();
  if (wanted === "") return undefined;

  const current = flocks.find((flock) => flockSlug(flock, flocks) === wanted);
  if (current !== undefined) return { flock: current, stale: false };

  const byId = flocks.find((flock) => flock.id.toLowerCase() === wanted);
  if (byId !== undefined) return { flock: byId, stale: true };

  // A name typed by hand, or a slug from before a second flock took the name.
  const byName = [...flocks]
    .sort((left, right) => left.id.localeCompare(right.id))
    .find((flock) => slugify(flock.name) === slugify(wanted));
  return byName === undefined ? undefined : { flock: byName, stale: true };
}

/** A bird kept as its own `Animal` record — a named hen, a rooster. */
export function isBird(animal: Pick<Animal, "species">): boolean {
  return animal.species === "chicken" || animal.species === "quail";
}

/**
 * The flock a named bird belongs to: the one kept in the coop she stands in.
 *
 * There is no `flockId` on an animal — §5.4 keeps birds as flocks, and a bird
 * with a record of her own is the exception — so the coop is the link. Only an
 * active flock of the same species claims her, and the earliest wins if two
 * share a coop.
 */
export function flockOfBird<T extends Flock>(
  bird: Pick<Animal, "id" | "species">,
  flocks: readonly T[],
  assignments: readonly ZoneAssignment[],
): T | undefined {
  const zones = new Set(openAssignments(assignments, bird.id).map((entry) => entry.zoneId));
  return [...flocks]
    .sort((left, right) => left.id.localeCompare(right.id))
    .find(
      (flock) =>
        flock.active &&
        flock.species === bird.species &&
        flock.zoneId !== undefined &&
        zones.has(flock.zoneId),
    );
}

/** A named bird's link: her flock's page, or the flock list when she has none. */
export function birdHref(
  bird: Pick<Animal, "id" | "species">,
  flocks: readonly Flock[],
  assignments: readonly ZoneAssignment[],
): string {
  const flock = flockOfBird(bird, flocks, assignments);
  return flock === undefined ? BASE : flockHref(flock, flocks);
}

/** The named birds standing in a flock's coop, for its page. */
export function birdsOfFlock<A extends Animal>(
  flock: Flock,
  flocks: readonly Flock[],
  animals: readonly A[],
  assignments: readonly ZoneAssignment[],
): A[] {
  return animals.filter(
    (animal) =>
      isBird(animal) &&
      isOnFarm(animal) &&
      flockOfBird(animal, flocks, assignments)?.id === flock.id,
  );
}
