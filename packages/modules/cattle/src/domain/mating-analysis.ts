import type { BreedShare } from "./cattle-profile.js";
import type { ParentRef } from "./cattle-profile.js";
import { buildPedigree, MAX_PEDIGREE_GENERATIONS, type PedigreeSource } from "./pedigree.js";

/**
 * What a pairing produces, before it happens (spec §5.2).
 *
 * Three questions get asked at the moment somebody picks a bull, and they are
 * asked in this order: what will the calf be, what will it look like, and is
 * this bull too close to this cow. The first two are arithmetic. The third is
 * the one that costs money if nobody asks it.
 */

/* ------------------------------------------------------------ composition */

const COMPOSITION_EPSILON = 0.05;

/**
 * The calf's breed composition — each parent contributes half of its own.
 *
 * ½ Maine × ½ Chi bred to a purebred Shorthorn gives ¼ Maine, ¼ Chi, ½
 * Shorthorn, which is what a breeder would work out on the back of a feed
 * ticket. Doing it here means the number on the calf's papers and the number
 * on the plan agree.
 *
 * Breed names are matched case-insensitively but reported in the spelling the
 * sire's side used, because "maine-anjou" and "Maine-Anjou" are one breed and
 * a composition that lists both adds to 100 while looking like a mistake.
 */
export function expectedComposition(
  sire: readonly BreedShare[],
  dam: readonly BreedShare[],
): BreedShare[] {
  const combined = new Map<string, { breed: string; percent: number }>();

  const add = (shares: readonly BreedShare[]) => {
    for (const share of shares) {
      const key = share.breed.trim().toLowerCase();
      const existing = combined.get(key);
      combined.set(key, {
        breed: existing?.breed ?? share.breed.trim(),
        percent: (existing?.percent ?? 0) + share.percent / 2,
      });
    }
  };

  // Sire first, so his spelling is the one that survives a disagreement.
  add(sire);
  add(dam);

  return [...combined.values()]
    .filter((share) => share.percent > COMPOSITION_EPSILON)
    .map((share) => ({ breed: share.breed, percent: Math.round(share.percent * 100) / 100 }))
    .sort((left, right) => right.percent - left.percent);
}

/* -------------------------------------------------------- common ancestors */

/** How this farm reads "too close" by default — §5.2's four generations. */
export const RELATEDNESS_GENERATIONS = 4;

export interface CommonAncestor {
  readonly ref: ParentRef;
  readonly name: string;
  readonly regNumber?: string | undefined;
  /** Generations from the sire down to this animal. 1 is his own sire. */
  readonly viaSire: number;
  readonly viaDam: number;
  /** This ancestor's own contribution to the calf's inbreeding coefficient. */
  readonly contribution: number;
}

/**
 * Every path from one animal up to an ancestor, as generation counts.
 *
 * A list rather than a single depth because line breeding puts the same bull
 * in two places on one side, and each route is its own term in Wright's
 * formula. Collapsing them to the shortest would understate the coefficient
 * for exactly the pedigrees where it matters.
 */
function pathsTo(
  from: ParentRef,
  source: PedigreeSource,
  generations: number,
): Map<string, { ref: ParentRef; depths: number[] }> {
  const found = new Map<string, { ref: ParentRef; depths: number[] }>();

  const walk = (ref: ParentRef, depth: number, seen: ReadonlySet<string>): void => {
    if (depth > generations) return;
    const key = `${ref.kind}:${ref.id}`;
    // A repeat on the path back to the root is a cycle, not line breeding.
    if (seen.has(key)) return;

    if (depth > 0) {
      const entry = found.get(key) ?? { ref, depths: [] };
      entry.depths.push(depth);
      found.set(key, entry);
    }

    const parents = source.parentsOf(ref);
    if (parents === undefined) return;

    const next = new Set(seen).add(key);
    if (parents.sire !== undefined) walk(parents.sire, depth + 1, next);
    if (parents.dam !== undefined) walk(parents.dam, depth + 1, next);
  };

  walk(from, 0, new Set());
  return found;
}

export interface RelatednessReport {
  readonly common: readonly CommonAncestor[];
  /**
   * Wright's coefficient of inbreeding for the calf, as a fraction.
   *
   * A half-sib mating is 0.125, a first-cousin mating 0.0625. Bounded by the
   * generations searched, so it is a floor rather than a final figure —
   * ancestors further back than the search contribute a little more.
   */
  readonly inbreedingCoefficient: number;
  readonly generationsSearched: number;
  /** True when either side's pedigree is too thin to say anything. */
  readonly pedigreeIncomplete: boolean;
}

/**
 * Are these two too close?
 *
 * Wright's formula, one term per path pair through each shared ancestor:
 * `(1/2)^(n₁+n₂+1)`. The ancestor's own inbreeding is not folded in — that
 * would need its coefficient, which needs its ancestors, and the papers do not
 * go far enough back on this place for the correction to be more than noise.
 * Undercounting slightly is the right direction for a warning to err in.
 *
 * A parent-child or full-sib pairing shows up here as a large coefficient
 * rather than as a special case, which is how it should: the formula already
 * knows those are the worst ones.
 */
export function relatedness(
  sire: ParentRef,
  dam: ParentRef,
  source: PedigreeSource,
  generations: number = RELATEDNESS_GENERATIONS,
): RelatednessReport {
  const sirePaths = pathsTo(sire, source, generations);
  const damPaths = pathsTo(dam, source, generations);

  const sireKey = `${sire.kind}:${sire.id}`;
  const damKey = `${dam.kind}:${dam.id}`;

  const common: CommonAncestor[] = [];
  let coefficient = 0;

  for (const [key, sireEntry] of sirePaths) {
    const damEntry = damPaths.get(key);
    if (damEntry === undefined) continue;

    let contribution = 0;
    for (const n1 of sireEntry.depths) {
      for (const n2 of damEntry.depths) {
        contribution += 0.5 ** (n1 + n2 + 1);
      }
    }
    coefficient += contribution;

    const described = source.describe(sireEntry.ref);
    common.push({
      ref: sireEntry.ref,
      name: described?.name ?? "Unknown",
      regNumber: described?.regNumber,
      viaSire: Math.min(...sireEntry.depths),
      viaDam: Math.min(...damEntry.depths),
      contribution,
    });
  }

  /*
   * A parent bred to its own offspring.
   *
   * An animal never appears in its own ancestor list, so the loop above cannot
   * see this case — and it is the closest relationship there is. Handled here
   * rather than folded into the walk, because "the dam is the sire's dam" is a
   * different shape of fact from "they share a grandsire".
   */
  const damIsAncestorOfSire = sirePaths.get(damKey);
  const sireIsAncestorOfDam = damPaths.get(sireKey);
  for (const [entry, other] of [
    [damIsAncestorOfSire, dam] as const,
    [sireIsAncestorOfDam, sire] as const,
  ]) {
    if (entry === undefined) continue;
    const already = common.some(
      (ancestor) => ancestor.ref.kind === other.kind && ancestor.ref.id === other.id,
    );
    if (already) continue;

    // Path length from the descendant, and zero from the ancestor to itself.
    const contribution = entry.depths.reduce((total, depth) => total + 0.5 ** (depth + 1), 0);
    coefficient += contribution;

    const described = source.describe(other);
    common.push({
      ref: other,
      name: described?.name ?? "Unknown",
      regNumber: described?.regNumber,
      viaSire: other.kind === sire.kind && other.id === sire.id ? 0 : Math.min(...entry.depths),
      viaDam: other.kind === dam.kind && other.id === dam.id ? 0 : Math.min(...entry.depths),
      contribution,
    });
  }

  const sireTree = buildPedigree(sire, source, Math.min(generations, MAX_PEDIGREE_GENERATIONS));
  const damTree = buildPedigree(dam, source, Math.min(generations, MAX_PEDIGREE_GENERATIONS));

  return {
    common: common.sort((left, right) => right.contribution - left.contribution),
    inbreedingCoefficient: coefficient,
    generationsSearched: generations,
    // Nothing above either parent means the search had nothing to compare, and
    // "no common ancestors" would read as a clean bill rather than as silence.
    pedigreeIncomplete:
      sireTree?.sire === undefined ||
      sireTree.dam === undefined ||
      damTree?.sire === undefined ||
      damTree.dam === undefined,
  };
}

/**
 * What to say about a coefficient.
 *
 * The thresholds are the ones seedstock breeders actually work to: under
 * 3.125% is a pairing nobody thinks twice about, 6.25% is first cousins and
 * gets a mention, and 12.5% is half-sibs and gets a warning. Above a quarter
 * is parent-offspring or full-sib territory, which is not a warning so much as
 * a question about whether the pedigree is right.
 */
export function relatednessVerdict(coefficient: number): {
  readonly level: "clear" | "note" | "caution" | "refuse";
  readonly summary: string;
} {
  const percent = (coefficient * 100).toFixed(1);

  if (coefficient >= 0.25) {
    return {
      level: "refuse",
      summary: `${percent}% inbreeding — that is a parent-offspring or full-sibling pairing. Check the pedigree before anything else.`,
    };
  }
  if (coefficient >= 0.125) {
    return {
      level: "caution",
      summary: `${percent}% inbreeding — half-siblings or closer. Expect some depression in growth and fertility.`,
    };
  }
  if (coefficient >= 0.0625) {
    return {
      level: "note",
      summary: `${percent}% inbreeding — around first cousins. Deliberate line breeding lives here; accidental line breeding also does.`,
    };
  }
  if (coefficient > 0) {
    return { level: "clear", summary: `${percent}% inbreeding — distant enough not to matter.` };
  }
  return { level: "clear", summary: "No common ancestors in the generations on file." };
}

/* ------------------------------------------------- where a makeup comes from */

export type CompositionOrigin = "papers" | "parents" | "unknown";

export interface ResolvedComposition {
  readonly composition: readonly BreedShare[];
  readonly source: CompositionOrigin;
  /**
   * When it came from the parents, whether both were known.
   *
   * Half a pedigree gives half an answer: a calf out of a 100% Shorthorn cow
   * by an unknown bull is at most "50% Shorthorn and 50% something", and
   * printing that as a complete makeup is a lie the screen can avoid telling.
   */
  readonly fromBothParents?: boolean | undefined;
}

/**
 * What breed an animal is (spec §5.2).
 *
 * **The papers win.** A registered animal's makeup is a fact the association
 * computed from a pedigree that goes back further than anything on this farm,
 * and it is the number a buyer will check. Recomputing it here from two
 * parents would produce a subtly different figure — the association rounds,
 * carries fractions of a percent, and knows generations we do not — and the
 * two disagreeing on a sale sheet is worse than either.
 *
 * **Otherwise it is half of each parent's**, which is what breeding is. A calf
 * out of a half-Maine cow by a purebred Chi is a quarter Maine and half Chi
 * whether or not anybody has papered her.
 *
 * The source travels with the answer, because "79.57% Maine, off the AMAA
 * papers" and "roughly three-quarters Maine, worked out from her parents" are
 * different claims and a screen that showed them identically would let the
 * second be quoted as the first.
 */
export function resolveComposition(
  own: readonly BreedShare[] | undefined,
  sire: readonly BreedShare[] | undefined,
  dam: readonly BreedShare[] | undefined,
): ResolvedComposition {
  if (own !== undefined && own.length > 0) return { composition: own, source: "papers" };

  const sireKnown = sire !== undefined && sire.length > 0;
  const damKnown = dam !== undefined && dam.length > 0;
  if (!sireKnown && !damKnown) return { composition: [], source: "unknown" };

  return {
    composition: expectedComposition(sire ?? [], dam ?? []),
    source: "parents",
    fromBothParents: sireKnown && damKnown,
  };
}

/** How to say where the makeup came from, on a screen. */
export function describeCompositionSource(resolved: ResolvedComposition): string | undefined {
  if (resolved.source === "papers") return "Off the papers.";
  if (resolved.source === "unknown") return undefined;
  return resolved.fromBothParents === true
    ? "Worked out from the sire and dam — nothing on the papers says otherwise."
    : "Worked out from the one parent on file, so this only accounts for half of it.";
}

/** What resolving a makeup off a pedigree needs to be able to look up. */
export interface CompositionLookup {
  /** The makeup on this animal's own papers, if it has any. */
  papersOf(ref: ParentRef): readonly BreedShare[] | undefined;
  parentsOf(ref: ParentRef): { sire?: ParentRef; dam?: ParentRef } | undefined;
}

/**
 * An animal's makeup, walking back as far as it has to.
 *
 * The papers win at every level. Only where an animal has none does this go up
 * to its parents — and only where *they* have none does it go up again. A
 * commercial cow with a registered sire and a registered dam gets a real
 * answer; so does her unpapered daughter.
 *
 * Bounded, because a pedigree can contain a loop once somebody mistypes a
 * registration number, and an unbounded walk on a screen somebody opened by
 * accident is a hung tab.
 */
export function resolveCompositionFor(
  ref: ParentRef,
  lookup: CompositionLookup,
  depth = RELATEDNESS_GENERATIONS,
): ResolvedComposition {
  const papers = lookup.papersOf(ref);
  if (papers !== undefined && papers.length > 0) return { composition: papers, source: "papers" };
  if (depth <= 0) return { composition: [], source: "unknown" };

  const parents = lookup.parentsOf(ref);
  const sire =
    parents?.sire === undefined
      ? undefined
      : resolveCompositionFor(parents.sire, lookup, depth - 1).composition;
  const dam =
    parents?.dam === undefined
      ? undefined
      : resolveCompositionFor(parents.dam, lookup, depth - 1).composition;

  return resolveComposition(undefined, sire, dam);
}
