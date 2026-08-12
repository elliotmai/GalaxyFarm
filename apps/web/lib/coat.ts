import {
  inferCoat,
  readPhenotype,
  type CattleProfile,
  type CoatInference,
  type ExternalAnimal,
  type ParentRef,
  type Phenotype,
} from "@galaxy-farm/module-cattle";

/**
 * Working every animal's coat genotype out from the herd as it stands
 * (spec §5.2).
 *
 * The domain does the genetics; this finds the evidence. It crosses both
 * stores, because a parent is either one of ours with a `CattleProfile` or a
 * name off a certificate with an `ExternalAnimal`, and it walks two directions:
 * *up* to the parents, whose alleles decide what the animal could be, and
 * *sideways* to its calves, because a red calf proves a black parent carries
 * red whatever anybody wrote on the card.
 *
 * **Nothing here is written down.** That is the requirement, not an
 * implementation detail: the day somebody records that a black bull threw a
 * red calf, every descendant's answer has to change with it. A genotype saved
 * at import time would still read "black, unknown" a year later and nothing on
 * any screen would look wrong.
 *
 * Kept in the app rather than the module for the same reason the composition
 * and defect walks are — the module has no idea where records live, and §4.1
 * keeps it that way.
 */

export interface Herd {
  readonly profiles: readonly CattleProfile[];
  readonly outsiders: readonly ExternalAnimal[];
}

/** As far up a pedigree as an inference is worth chasing. */
const MAX_GENERATIONS = 6;

interface Node {
  readonly key: string;
  readonly colour?: string | undefined;
  readonly tested?: CattleProfile["coatGenotype"];
  readonly sire?: ParentRef | undefined;
  readonly dam?: ParentRef | undefined;
}

const keyOf = (ref: ParentRef): string => `${ref.kind}:${ref.id}`;

function index({ profiles, outsiders }: Herd) {
  const byAnimal = new Map(profiles.map((profile) => [profile.animalId, profile]));
  const byOutsider = new Map(outsiders.map((entry) => [entry.id, entry]));

  const node = (ref: ParentRef): Node | undefined => {
    if (ref.kind === "animal") {
      const profile = byAnimal.get(ref.id);
      // A cattle profile is written the first time somebody edits an animal's
      // breeding or genetics, so plenty of the herd has none — and one of ours
      // picked out of a dropdown certainly exists whether or not that row
      // does. Returning nothing for her made the whole colour prediction
      // vanish with no explanation; an animal nobody has recorded anything
      // about is "nothing known", which is a different and far more useful
      // answer than "no such animal".
      if (profile === undefined) return { key: keyOf(ref) };
      return {
        key: keyOf(ref),
        colour: profile.colour,
        ...(profile.coatGenotype === undefined ? {} : { tested: profile.coatGenotype }),
        sire: profile.sire,
        dam: profile.dam,
      };
    }
    const outsider = byOutsider.get(ref.id);
    if (outsider === undefined) return undefined;
    return {
      key: keyOf(ref),
      colour: outsider.colour,
      sire: outsider.sire,
      dam: outsider.dam,
    };
  };

  /**
   * Every animal's calves' coats, by parent.
   *
   * Built once for the whole herd rather than searched per animal: this is
   * read for every row of a list, and scanning the herd inside a render is how
   * a page with forty cattle on it takes a second to draw.
   */
  const calves = new Map<string, Phenotype[]>();
  const addCalf = (parent: ParentRef | undefined, colour: string | undefined) => {
    if (parent === undefined) return;
    const phenotype = readPhenotype(colour);
    if (phenotype.base === undefined && phenotype.pattern === undefined) return;
    const held = calves.get(keyOf(parent));
    if (held === undefined) calves.set(keyOf(parent), [phenotype]);
    else held.push(phenotype);
  };

  for (const profile of profiles) {
    addCalf(profile.sire, profile.colour);
    addCalf(profile.dam, profile.colour);
  }
  for (const outsider of outsiders) {
    addCalf(outsider.sire, outsider.colour);
    addCalf(outsider.dam, outsider.colour);
  }

  return { node, calves };
}

/**
 * A resolver for the whole herd, memoised.
 *
 * One of these per render, not one per animal: an ancestor sits under half the
 * herd, and working it out afresh for each descendant is the same walk done
 * thirty times.
 */
export function coatResolver(herd: Herd) {
  const { node, calves } = index(herd);
  const done = new Map<string, CoatInference | undefined>();

  const infer = (
    entry: Node | undefined,
    generation: number,
    // A repeated ancestor is ordinary in line breeding; a repeat on the way
    // back up is a mistyped registration making an animal its own grandsire,
    // and walking that forever helps nobody.
    seen: ReadonlySet<string>,
  ): CoatInference | undefined => {
    if (entry === undefined) return undefined;
    if (generation === 0 && done.has(entry.key)) return done.get(entry.key);

    const observed = readPhenotype(entry.colour);
    const deeper = generation < MAX_GENERATIONS && !seen.has(entry.key);
    const nextSeen = new Set(seen).add(entry.key);

    // Once each. Calling this twice per side — as a `x === undefined ? … : x`
    // would — walks the whole pedigree twice at every level, which is 2^n
    // walks by the time it reaches a fifth generation.
    const parent = (ref: ParentRef | undefined) =>
      !deeper || ref === undefined ? undefined : infer(node(ref), generation + 1, nextSeen);
    const sire = parent(entry.sire);
    const dam = parent(entry.dam);

    const result = inferCoat({
      ...(entry.tested === undefined ? {} : { tested: entry.tested }),
      observed,
      ...(sire === undefined ? {} : { sire }),
      ...(dam === undefined ? {} : { dam }),
      progeny: calves.get(entry.key) ?? [],
    });

    if (generation === 0) done.set(entry.key, result);
    return result;
  };

  return {
    /** What is known about this animal's coat, worked out fresh. */
    of: (ref: ParentRef): CoatInference | undefined => infer(node(ref), 0, new Set()),
  };
}

/** The one-animal case, for a screen that has only itself to show. */
export function coatFor(ref: ParentRef, herd: Herd): CoatInference | undefined {
  return coatResolver(herd).of(ref);
}
