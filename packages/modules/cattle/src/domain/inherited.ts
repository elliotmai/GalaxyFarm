import {
  carries,
  isKnownFree,
  GENETIC_DEFECTS,
  statusOf,
  type DefectStatus,
  type GeneticDefect,
  type GeneticTest,
} from "./genetics.js";
import {
  EXTENSION_ALLELES,
  ROAN_ALLELES,
  coatName,
  extensionColour,
  roanColour,
  type CoatGenotype,
  type ExtensionAllele,
  type RoanAllele,
} from "./coat-colour.js";

/**
 * What an unregistered animal inherits from registered parents (spec §5.2).
 *
 * Most of the calves on this place will never be hair-tested and most will
 * never be papered. Their sires and dams are, and that is enough to answer
 * both of the questions that matter — what a calf can carry, and what it can
 * throw — because a recessive an animal does not have cannot appear in it, and
 * one it does have came from a parent.
 *
 * This is exactly what the associations do. Their "free by pedigree" is two
 * tested-free parents; their "possible carrier" is a tested carrier standing
 * within three generations. Neither is a test result and neither is treated as
 * one here: an inherited verdict is always marked as inherited, so a hair card
 * and a deduction never read the same on a screen.
 *
 * The asymmetry is the whole thing. **Free is inherited only from certainty;
 * suspicion is inherited from anywhere.** Two free parents cannot produce a
 * carrier, so free travels down — but one carrier anywhere in three
 * generations makes a descendant possible, and that travels down through any
 * number of untested animals in between. Getting that backwards is how a
 * carrier gets called clean.
 */

export interface InheritedDefect {
  readonly defect: GeneticDefect;
  readonly status: DefectStatus;
  /** True when this was deduced rather than tested. */
  readonly inherited: boolean;
  /** The animals the verdict rests on, in the words a breeder uses. */
  readonly because: string;
}

/** One ancestor's contribution — a name and what it tested. */
export interface AncestorTests {
  readonly name: string;
  /** Generations above: 1 is a parent. */
  readonly generation: number;
  readonly tests: readonly GeneticTest[];
}

/**
 * How far a carrier casts a shadow.
 *
 * Three, matching the associations: a tested carrier inside three generations
 * makes a descendant a possible carrier on their own papers.
 */
export const SUSPECT_GENERATIONS = 3;

/**
 * What this animal is, defect by defect, own results first.
 *
 * An own result always wins — it is a test on this animal and nothing deduced
 * beats it, in either direction. A hair card saying carrier stands against two
 * free parents (which means a parentage error, and hiding it would be worse
 * than reporting it), and a hair card saying free stands against a carrier
 * grandsire.
 */
export function inheritedDefects(
  own: readonly GeneticTest[],
  ancestors: readonly AncestorTests[],
  defects: readonly GeneticDefect[] = GENETIC_DEFECTS,
): InheritedDefect[] {
  const parents = ancestors.filter((entry) => entry.generation === 1);
  const within = ancestors.filter((entry) => entry.generation <= SUSPECT_GENERATIONS);

  return defects.map((defect) => {
    const mine = statusOf(own, defect);
    if (mine !== "untested") {
      return { defect, status: mine, inherited: false, because: "Tested." };
    }

    // A carrier anywhere close by. Checked before the free case, because an
    // animal cannot be both and the association's orange beats its green.
    const carriers = within.filter((entry) => carries(statusOf(entry.tests, defect)));
    if (carriers.length > 0) {
      return {
        defect,
        status: "suspect",
        inherited: true,
        because: `${carriers.map((entry) => entry.name).join(", ")} carries it, within ${SUSPECT_GENERATIONS} generations.`,
      };
    }

    // Free by parentage needs *both* parents known free. One free parent says
    // nothing at all: the other can still have passed it.
    const known = parents.filter((entry) => isKnownFree(statusOf(entry.tests, defect)));
    if (parents.length === 2 && known.length === 2) {
      return {
        defect,
        status: "free_by_parentage",
        inherited: true,
        because: `${known.map((entry) => entry.name).join(" and ")} are both free, so nothing could have passed it.`,
      };
    }

    return {
      defect,
      status: "untested",
      inherited: false,
      because:
        parents.length === 0
          ? "No parents on file."
          : known.length === 1
            ? "Only one parent is known free, and the other side is untested."
            : "Neither parent has a result.",
    };
  });
}

/* ------------------------------------------------------- what it can carry */

export interface CarriedColour {
  /** The coat as it is seen. */
  readonly coat: string;
  /**
   * Every genotype the parents make possible, with its share.
   *
   * More than one is the normal case and the point of the whole exercise: a
   * black calf out of a black bull carrying red is either `ED/ED` or `ED/e`,
   * and those two throw entirely different calves out of a red cow.
   */
  readonly possible: readonly { readonly genotype: string; readonly chance: number }[];
  /** Chance it carries red without showing it. */
  readonly carriesRed: number;
  /** Chance it carries roan without showing it — it always shows, so zero. */
  readonly carriesRoan: number;
}

const cross = <A extends string>(
  sire: readonly [A, A],
  dam: readonly [A, A],
): [A, A][] => sire.flatMap((left) => dam.map((right) => [left, right] as [A, A]));

/** `ED/e` and `e/ED` are one genotype. Sorted by dominance so they read alike. */
const key = <A extends string>(pair: readonly [A, A], order: readonly A[]): string => {
  const sorted = [...pair].sort((left, right) => order.indexOf(left) - order.indexOf(right));
  return sorted.join("/");
};

/**
 * What an untested animal can be carrying, given its parents.
 *
 * The reason this is worth having: **a recessive is invisible.** A black cow
 * out of a red-carrying bull looks exactly like a black cow out of two
 * homozygous blacks, and the two throw different calves. Nobody is going to
 * hair-test every heifer on the place, but the parents are usually known, and
 * the parents settle it to a probability.
 *
 * The observed coat is used to *narrow* the possibilities where it can. A calf
 * that came out red is `e/e` and nothing else, whatever the odds said — so
 * where the coat is known, every genotype that disagrees with it is dropped
 * and the rest are renormalised. That turns a prediction into a deduction.
 */
export function carriedColour(
  sire: CoatGenotype | undefined,
  dam: CoatGenotype | undefined,
  observed?: { readonly extension?: string | undefined; readonly pattern?: string | undefined },
): CarriedColour | undefined {
  if (sire?.extension === undefined || dam?.extension === undefined) return undefined;

  const extensionPairs = cross(sire.extension, dam.extension);
  const roanPairs =
    sire.roan === undefined || dam.roan === undefined ? undefined : cross(sire.roan, dam.roan);

  const counted = new Map<string, { pair: [ExtensionAllele, ExtensionAllele]; count: number }>();
  for (const pair of extensionPairs) {
    // A coat that was actually seen rules out everything that disagrees with
    // it. A red calf is e/e however unlikely that was beforehand.
    if (observed?.extension !== undefined && extensionColour(pair) !== observed.extension) continue;
    const name = key(pair, EXTENSION_ALLELES);
    const held = counted.get(name);
    counted.set(name, { pair, count: (held?.count ?? 0) + 1 });
  }

  const total = [...counted.values()].reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return undefined;

  const possible = [...counted.entries()]
    .map(([genotype, entry]) => ({ genotype, chance: entry.count / total }))
    .sort((left, right) => right.chance - left.chance);

  // Carrying red means black to look at with an `e` behind it. A red animal
  // does not "carry" red — it is red.
  const hidden = [...counted.values()]
    .filter((entry) => extensionColour(entry.pair) === "black" && entry.pair.includes("e"))
    .reduce((sum, entry) => sum + entry.count, 0);

  const roan =
    roanPairs === undefined
      ? undefined
      : roanPairs.filter((pair) => observed?.pattern === undefined || roanColour(pair) === observed.pattern);

  const first = [...counted.values()][0]?.pair;

  return {
    coat:
      first === undefined
        ? "unknown"
        : coatName(first, roan?.[0] ?? (["r", "r"] as [RoanAllele, RoanAllele])),
    possible,
    carriesRed: hidden / total,
    // Roan is co-dominant: an animal with one `R` is roan to look at. There is
    // no such thing as carrying it unseen, and saying otherwise would suggest a
    // test worth running that is not.
    carriesRoan: 0,
  };
}

/** How to say it on a screen, in the words a breeder would use. */
export function describeCarried(carried: CarriedColour): string | undefined {
  if (carried.carriesRed === 0) return undefined;
  if (carried.carriesRed === 1) return "Carries red — every calf out of a red mate can be red.";
  return `${Math.round(carried.carriesRed * 100)}% chance it carries red, which nothing about its own coat will show.`;
}

/** Every roan allele pair a mating can throw, for completeness on a screen. */
export function possibleRoan(
  sire: CoatGenotype | undefined,
  dam: CoatGenotype | undefined,
): { genotype: string; chance: number }[] {
  if (sire?.roan === undefined || dam?.roan === undefined) return [];

  const counted = new Map<string, number>();
  for (const pair of cross(sire.roan, dam.roan)) {
    const name = key(pair, ROAN_ALLELES);
    counted.set(name, (counted.get(name) ?? 0) + 1);
  }

  const total = [...counted.values()].reduce((sum, count) => sum + count, 0);
  return [...counted.entries()]
    .map(([genotype, count]) => ({ genotype, chance: count / total }))
    .sort((left, right) => right.chance - left.chance);
}
