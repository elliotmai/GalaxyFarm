import type { ExternalAnimal } from "../domain/pedigree.js";

/**
 * Every animal in the associations, as something this app can ask questions of
 * (spec §4.1, §5.2).
 *
 * The crawler builds a graph of the registries. This is the seam between it and
 * everything else: the module states what it needs to be able to *ask*, and an
 * adapter in `packages/infrastructure` answers it. §4.1 keeps the module
 * ignorant of where records live, and this is no exception — nothing here
 * mentions a driver, a query language or a hostname.
 *
 * ## Why this is a separate thing from the ancestors on file
 *
 * They answer different questions and they are trusted differently.
 *
 * The **ancestors** are the pedigree behind this herd: a few dozen records,
 * edited by hand, corrected when a page is misread, and available offline
 * because a phone in a barn has no signal. They are *ours*.
 *
 * The **catalogue** is everything the crawler found: a hundred thousand
 * animals nobody here has ever owned, read-only, and useful for exactly one
 * thing — finding the bull whose straw is being considered, and pulling him
 * across. Mixing the two would bury the thirty records that matter under the
 * rest, and would mean a mistyped crawl silently rewriting a pedigree somebody
 * built by hand.
 *
 * So the flow is one-way and deliberate: **search the catalogue, then bring an
 * animal across into the ancestors.** Nothing is copied until somebody asks for
 * it, and once copied it is ours to correct.
 */

export interface RegistryQuery {
  /** Name, registration number, or tattoo — any part, in any order. */
  readonly text?: string | undefined;
  /** An association code, or absent for all of them. */
  readonly association?: string | undefined;
  /**
   * Bulls or cows only.
   *
   * Worth having at the source rather than filtering after: picking a sire out
   * of a list that includes cows is how a cow ends up in a sire slot, and
   * every relatedness figure and colour prediction drawn afterwards looks
   * perfectly ordinary and is nonsense.
   */
  readonly sex?: "male" | "female" | undefined;
  /** A page's worth. The catalogue is far too large to hand over whole. */
  readonly limit?: number | undefined;
}

/**
 * One animal as the catalogue holds it.
 *
 * Deliberately the same shape as an `ExternalAnimal` minus the bookkeeping
 * every record of ours carries — no id of ours, no property, no timestamps —
 * because that is exactly what "not ours yet" means. Bringing one across is
 * then a matter of stamping those on, not of translating a foreign shape.
 */
export type RegistryAnimal = Omit<
  ExternalAnimal,
  "id" | "propertyId" | "createdAt" | "updatedAt" | "deletedAt" | "sire" | "dam"
> & {
  /** Whoever issued the number this record is keyed by. */
  readonly association: string;
  readonly regNumber: string;
  /** The parents as the registry names them, by number rather than by our id. */
  readonly sire?: { association: string; regNumber: string } | undefined;
  readonly dam?: { association: string; regNumber: string } | undefined;
};

/** The fields on a catalogue animal that are `Date`s and survive JSON as strings. */
const DATE_FIELDS = ["dob", "disposedOn"] as const;

/**
 * A catalogue animal, after it has been through JSON.
 *
 * This shape crosses the wire — the graph is searched on the server and read
 * in a browser — and JSON has no date. A `Date` put through `stringify` and
 * back is a *string wearing the type of a Date*: it type-checks everywhere,
 * and the first thing to call `.toISOString()` on it throws.
 *
 * Everything that fetches one goes through here, so the promise the type makes
 * is true again before anything reads it. An unparseable date is dropped
 * rather than kept as `Invalid Date`, which fails later and further away.
 */
export function reviveRegistryAnimal<T extends RegistryAnimal>(animal: T): T {
  const revived: Record<string, unknown> = { ...animal };

  for (const field of DATE_FIELDS) {
    const value = revived[field];
    if (typeof value !== "string") continue;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) delete revived[field];
    else revived[field] = parsed;
  }

  return revived as T;
}

export interface RegistryGraph {
  /**
   * Find animals matching a query.
   *
   * Returns at most `limit`. A search that silently truncates is a search that
   * lies about what is out there, so the count of everything matching comes
   * back alongside the page.
   */
  search(query: RegistryQuery): Promise<{ found: readonly RegistryAnimal[]; total: number }>;

  /** One animal by the number that identifies it. */
  get(association: string, regNumber: string): Promise<RegistryAnimal | undefined>;

  /**
   * An animal and everything above it, to a bounded depth.
   *
   * Bounded because a graph can contain a cycle the moment a registration is
   * mistyped, and because nobody reads more than five generations. This is the
   * one query a graph is genuinely better at than a table, and it is why the
   * crawler's shape is worth keeping.
   */
  pedigree(
    association: string,
    regNumber: string,
    generations: number,
  ): Promise<readonly (RegistryAnimal & { position: string; generation: number })[]>;
}

/** As far back as the catalogue is ever asked to walk. */
export const MAX_CATALOGUE_GENERATIONS = 5;
