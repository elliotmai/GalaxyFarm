import { useMemo } from "react";

import { displayName, type Animal } from "@galaxy-farm/core";
import type {
  CattleProfile,
  ExternalAnimal,
  ParentRef,
  PedigreeSource,
} from "@galaxy-farm/module-cattle";

/**
 * Resolving a parent reference against what is on the device (spec §5.2).
 *
 * `buildPedigree` and `wouldCreateCycle` both take a `PedigreeSource` — the
 * module has no idea where records live, which is what keeps §4.1 intact. This
 * is the composition half, and it lives in `apps/web` for the same reason.
 *
 * It is shared rather than written twice because the two callers must agree.
 * The pedigree tab draws the tree and the ancestors screen refuses a loop; if
 * one resolved a reference the other could not, the screen would reject an
 * edit the chart was already drawing quite happily.
 */
export function usePedigreeSource({
  animals,
  profiles,
  outsiders,
}: {
  readonly animals: readonly Animal[];
  readonly profiles: readonly CattleProfile[];
  readonly outsiders: readonly ExternalAnimal[];
}): PedigreeSource {
  return useMemo(() => {
    const animalById = new Map(animals.map((animal) => [animal.id, animal]));
    const profileByAnimal = new Map(profiles.map((profile) => [profile.animalId, profile]));
    const outsiderById = new Map(outsiders.map((outsider) => [outsider.id, outsider]));

    return {
      parentsOf(ref: ParentRef) {
        const record =
          ref.kind === "animal" ? profileByAnimal.get(ref.id) : outsiderById.get(ref.id);
        if (record === undefined) return undefined;
        return {
          ...(record.sire === undefined ? {} : { sire: record.sire }),
          ...(record.dam === undefined ? {} : { dam: record.dam }),
        };
      },

      describe(ref: ParentRef) {
        if (ref.kind === "animal") {
          const animal = animalById.get(ref.id);
          if (animal === undefined) return undefined;
          // Her own registration number if she has one — a pedigree handed to
          // a buyer is read against certificates, not against barn names.
          const reg = profileByAnimal.get(ref.id)?.registrations[0]?.regNumber;
          return { name: displayName(animal), ...(reg === undefined ? {} : { regNumber: reg }) };
        }

        const outsider = outsiderById.get(ref.id);
        if (outsider === undefined) return undefined;
        return {
          name: outsider.name,
          ...(outsider.regNumber === undefined ? {} : { regNumber: outsider.regNumber }),
        };
      },
    };
  }, [animals, profiles, outsiders]);
}
