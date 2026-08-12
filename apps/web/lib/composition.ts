import type { ParentRef } from "@galaxy-farm/module-cattle";
import {
  resolveCompositionFor,
  type CattleProfile,
  type CompositionLookup,
  type ExternalAnimal,
  type ResolvedComposition,
} from "@galaxy-farm/module-cattle";
import type { Ulid } from "@galaxy-farm/core";

/**
 * Where an animal's breed makeup comes from (spec §5.2).
 *
 * The papers win. A registered animal's makeup is what the association
 * computed off a pedigree going back further than anything on this farm, and
 * it is the number a buyer checks. Recomputing it from two parents would give
 * a subtly different figure — they round, they carry fractions of a percent,
 * and they know generations we do not — and the two disagreeing on a sale
 * sheet is worse than either alone.
 *
 * Where an animal has no papers, it is half of each parent's, walked back
 * until something *does* have papers. That is what makes it useful: a
 * commercial cow with a registered sire and a registered dam gets a real
 * answer, and so does her unpapered daughter.
 *
 * One lookup for the whole screen, because the walk crosses both stores — a
 * parent is either one of ours with a `CattleProfile` or a name off a
 * certificate with an `ExternalAnimal` — and nothing else should have to know
 * that.
 */
export function compositionLookup(
  profiles: readonly CattleProfile[],
  outsiders: readonly ExternalAnimal[],
): CompositionLookup {
  const byAnimal = new Map<Ulid, CattleProfile>(
    profiles.map((profile) => [profile.animalId, profile]),
  );
  const byId = new Map<Ulid, ExternalAnimal>(outsiders.map((entry) => [entry.id, entry]));

  return {
    papersOf(ref: ParentRef) {
      return ref.kind === "animal"
        ? byAnimal.get(ref.id)?.breedComposition
        : byId.get(ref.id)?.breedComposition;
    },
    parentsOf(ref: ParentRef) {
      const record = ref.kind === "animal" ? byAnimal.get(ref.id) : byId.get(ref.id);
      if (record === undefined) return undefined;
      return {
        ...(record.sire === undefined ? {} : { sire: record.sire }),
        ...(record.dam === undefined ? {} : { dam: record.dam }),
      };
    },
  };
}

/** The makeup of one of ours. */
export function compositionOfAnimal(
  animalId: Ulid,
  lookup: CompositionLookup,
): ResolvedComposition {
  return resolveCompositionFor({ kind: "animal", id: animalId }, lookup);
}
