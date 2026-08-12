import type { Ulid } from "@galaxy-farm/core";
import {
  carriedColour,
  inheritedDefects,
  type AncestorTests,
  type CarriedColour,
  type CattleProfile,
  type CoatGenotype,
  type ExternalAnimal,
  type InheritedDefect,
  type ParentRef,
  SUSPECT_GENERATIONS,
} from "@galaxy-farm/module-cattle";

/**
 * Working an animal's genetics out from its parents (spec §5.2).
 *
 * Almost nothing on this place is hair-tested. The papered ancestors are, and
 * that is enough — a recessive an animal does not have cannot appear in it,
 * and one it does have came from a parent.
 *
 * The walk crosses both stores: a parent is either one of ours with a
 * `CattleProfile` or a name off a certificate with an `ExternalAnimal`. Kept
 * here, in the app, for the same reason the composition lookup is — the module
 * has no idea where records live, and §4.1 keeps it that way.
 */

interface Records {
  readonly profiles: readonly CattleProfile[];
  readonly outsiders: readonly ExternalAnimal[];
}

interface Resolved {
  readonly name: string;
  readonly tests: readonly { defect: string; status: string }[];
  readonly coat?: CoatGenotype | undefined;
  readonly sire?: ParentRef | undefined;
  readonly dam?: ParentRef | undefined;
}

function lookup({ profiles, outsiders }: Records) {
  const byAnimal = new Map(profiles.map((profile) => [profile.animalId, profile]));
  const byId = new Map(outsiders.map((entry) => [entry.id, entry]));

  return (ref: ParentRef, name: string): Resolved | undefined => {
    if (ref.kind === "animal") {
      const profile = byAnimal.get(ref.id);
      if (profile === undefined) return undefined;
      return {
        name,
        tests: profile.geneticTests,
        coat: profile.coatGenotype,
        sire: profile.sire,
        dam: profile.dam,
      };
    }
    const outsider = byId.get(ref.id);
    if (outsider === undefined) return undefined;
    return {
      name: outsider.name,
      tests: outsider.geneticTests ?? [],
      sire: outsider.sire,
      dam: outsider.dam,
    };
  };
}

/**
 * Every ancestor within the range a carrier casts a shadow over.
 *
 * Bounded at the association's three generations rather than walked to the
 * root — beyond that a carrier no longer makes a descendant "possible" on
 * anybody's papers, and an unbounded walk on a pedigree containing a mistyped
 * loop is a hung tab.
 */
export function ancestorTests(
  start: { readonly sire?: ParentRef | undefined; readonly dam?: ParentRef | undefined },
  records: Records,
): AncestorTests[] {
  const resolve = lookup(records);
  const found: AncestorTests[] = [];
  const seen = new Set<string>();

  const walk = (
    parents: { sire?: ParentRef | undefined; dam?: ParentRef | undefined },
    generation: number,
  ) => {
    if (generation > SUSPECT_GENERATIONS) return;

    for (const [ref, role] of [
      [parents.sire, "sire"],
      [parents.dam, "dam"],
    ] as const) {
      if (ref === undefined) continue;
      const key = `${ref.kind}:${ref.id}`;
      // A repeated ancestor is ordinary in line breeding; a repeat on the way
      // back up is a loop, and walking it forever helps nobody.
      if (seen.has(key)) continue;
      seen.add(key);

      const record = resolve(ref, role);
      if (record === undefined) continue;

      found.push({
        name: record.name,
        generation,
        tests: record.tests as AncestorTests["tests"],
      });
      walk({ sire: record.sire, dam: record.dam }, generation + 1);
    }
  };

  walk(start, 1);
  return found;
}

/** What this animal is, defect by defect, own results first then deduced. */
export function defectsFor(
  own: readonly { defect: string; status: string }[],
  parents: { readonly sire?: ParentRef | undefined; readonly dam?: ParentRef | undefined },
  records: Records,
): InheritedDefect[] {
  return inheritedDefects(own as never, ancestorTests(parents, records));
}

/**
 * What colour it can be hiding, given its parents' typed coats.
 *
 * Only the parents, not the whole tree: an animal's own genotype is decided
 * entirely by the two alleles it got, and a grandparent adds nothing once the
 * parents are typed. Where a parent is untyped this returns nothing rather
 * than a guess.
 */
export function carriedColourFor(
  parents: { readonly sire?: ParentRef | undefined; readonly dam?: ParentRef | undefined },
  records: Records,
  observed?: { readonly extension?: string | undefined; readonly pattern?: string | undefined },
): CarriedColour | undefined {
  const resolve = lookup(records);
  const sire = parents.sire === undefined ? undefined : resolve(parents.sire, "sire")?.coat;
  const dam = parents.dam === undefined ? undefined : resolve(parents.dam, "dam")?.coat;

  return carriedColour(sire, dam, observed);
}

/** Which of ours the profile belongs to, for a caller holding only an id. */
export function profileOf(
  animalId: Ulid,
  profiles: readonly CattleProfile[],
): CattleProfile | undefined {
  return profiles.find((profile) => profile.animalId === animalId);
}
