import { displayName, isUlid, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  allRegistrations,
  canBe,
  tankLocation,
  type BreedingRecord,
  type ExternalAnimal,
  type SemenInventory,
  type SexVerdict,
} from "@galaxy-farm/module-cattle";
import type { SearchOption } from "@galaxy-farm/ui";

/**
 * Saying who the bull was, once, for every screen that asks (spec §5.2).
 *
 * Three screens ask the same question and used to answer it three ways. The
 * tank took a name typed on the cane and nothing else, so a straw could not be
 * joined to the bull whose pedigree is already on file; the breeding form
 * asked again from scratch; and the ancestors on file — the whole point of the
 * catalog import — were reachable from neither. What came out the far end was
 * a calf whose sire was a string.
 *
 * So the vocabulary lives here: four ways to name him, one encoding for the
 * picker, and one mapping onto each record that holds a sire. Joining a straw
 * to an ancestor is then worth something on its own — the breeding drawn from
 * it inherits the reference without anybody being asked a second time, and the
 * calving flow pedigrees the calf from it.
 */

export type SireChoice =
  | { readonly kind: "straw"; readonly id: Ulid }
  | { readonly kind: "bull"; readonly id: Ulid }
  | { readonly kind: "external"; readonly id: Ulid }
  | { readonly kind: "name"; readonly name: string };

export interface SireLookup {
  readonly animals: readonly Animal[];
  readonly outsiders: readonly ExternalAnimal[];
  /** The tank. Absent where a straw is not one of the answers. */
  readonly straws?: readonly SemenInventory[] | undefined;
}

/**
 * What the picker's value means.
 *
 * The picker offers rows from three record types and accepts a name belonging
 * to none of them, so the value has to say which. The prefix does that, and
 * the id has to be a ULID as well, so a bull somebody genuinely wrote down as
 * "bull: the red one" is still read as a name.
 */
export function parseSire(value: string): SireChoice | undefined {
  const typed = value.trim();
  if (typed === "") return undefined;

  const colon = typed.indexOf(":");
  const prefix = colon === -1 ? "" : typed.slice(0, colon);
  const rest = typed.slice(colon + 1);
  if ((prefix === "straw" || prefix === "bull" || prefix === "external") && isUlid(rest)) {
    return { kind: prefix, id: rest };
  }
  return { kind: "name", name: typed };
}

/** The value that picks a record already on file. */
export const sireValue = (kind: "straw" | "bull" | "external", id: Ulid): string => `${kind}:${id}`;

/**
 * The bulls worth offering: ours, and the ones on the papers.
 *
 * A cow in this list is how a cow gets recorded as somebody's sire, and every
 * relatedness figure and colour prediction drawn afterwards is then wrong in a
 * way that looks perfectly ordinary. The sexes come from where each ancestor
 * sits in the pedigrees on file, because a certificate has a sire column and a
 * dam column rather than a sex field.
 */
export function bullOptions(
  lookup: Pick<SireLookup, "animals" | "outsiders">,
  sexes: ReadonlyMap<Ulid, SexVerdict>,
): SearchOption[] {
  const ours = lookup.animals
    .filter(
      (animal) =>
        animal.species === "cattle" && animal.sex === "male" && animal.status === "active",
    )
    .map((animal) => ({
      value: sireValue("bull", animal.id),
      label: displayName(animal),
      ...(animal.tagNumber === undefined ? {} : { detail: animal.tagNumber }),
      group: "Bulls here",
    }));

  const papers = [...lookup.outsiders]
    .filter((entry) => canBe(sexes.get(entry.id), "male"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const registrations = allRegistrations(entry)
        .map((registration) => `${registration.association} ${registration.regNumber}`)
        .join(" · ");
      return {
        value: sireValue("external", entry.id),
        label: entry.name,
        ...(registrations === "" ? {} : { detail: registrations }),
        group: "On the papers",
      };
    });

  return [...ours, ...papers];
}

/**
 * The tank, most stocked first.
 *
 * Empty canes stay on the list. A breeding entered a fortnight late, with the
 * last straw of that bull already drawn, is still that bull's breeding — it
 * just leaves the count alone.
 */
export function strawOptions(straws: readonly SemenInventory[]): SearchOption[] {
  return [...straws]
    .sort(
      (left, right) =>
        right.strawsOnHand - left.strawsOnHand || left.sireName.localeCompare(right.sireName),
    )
    .map((straw) => {
      const count =
        straw.strawsOnHand === 0
          ? "none left"
          : `${straw.strawsOnHand} straw${straw.strawsOnHand === 1 ? "" : "s"}`;
      return {
        value: sireValue("straw", straw.id),
        label: straw.sireName,
        detail: [count, tankLocation(straw)].filter((part) => part !== undefined).join(" · "),
        group: "In the tank",
      };
    });
}

/** His name, as the record that was picked has it. */
export function sireNameOf(choice: SireChoice, lookup: SireLookup): string | undefined {
  if (choice.kind === "name") return choice.name;
  if (choice.kind === "bull") {
    const bull = lookup.animals.find((animal) => animal.id === choice.id);
    return bull === undefined ? undefined : displayName(bull);
  }
  if (choice.kind === "external") {
    return lookup.outsiders.find((entry) => entry.id === choice.id)?.name;
  }
  return (lookup.straws ?? []).find((entry) => entry.id === choice.id)?.sireName;
}

/**
 * What a straw says about its sire.
 *
 * The name is written every time, alongside whatever reference there is: a
 * bull gets sold and an ancestor record gets merged, and the cane in the tank
 * still says a name on it.
 */
export function strawSire(
  choice: SireChoice,
  lookup: Pick<SireLookup, "animals" | "outsiders">,
): Pick<SemenInventory, "sireAnimalId" | "sireExternalId" | "sireName"> | undefined {
  const named = sireNameOf(choice, lookup);
  if (named === undefined || named.trim() === "") return undefined;

  return {
    ...(choice.kind === "bull" ? { sireAnimalId: choice.id } : {}),
    ...(choice.kind === "external" ? { sireExternalId: choice.id } : {}),
    sireName: named,
  };
}

/**
 * What a breeding says about its sire.
 *
 * A straw hands over its own references as well as its name, which is what
 * joins the calf to the pedigree: whoever filled in the tank did the work of
 * saying who the bull was, and nobody should be asked again in the chute.
 */
export function breedingSire(choice: SireChoice, lookup: SireLookup): Partial<BreedingRecord> {
  if (choice.kind === "name") return { sireName: choice.name };

  if (choice.kind === "bull") {
    const named = sireNameOf(choice, lookup);
    return { bullId: choice.id, ...(named === undefined ? {} : { sireName: named }) };
  }

  if (choice.kind === "external") {
    const named = sireNameOf(choice, lookup);
    return { sireExternalId: choice.id, ...(named === undefined ? {} : { sireName: named }) };
  }

  const straw = (lookup.straws ?? []).find((entry) => entry.id === choice.id);
  if (straw === undefined) return { semenInventoryId: choice.id };

  return {
    semenInventoryId: straw.id,
    ...(straw.sireAnimalId === undefined ? {} : { bullId: straw.sireAnimalId }),
    ...(straw.sireExternalId === undefined ? {} : { sireExternalId: straw.sireExternalId }),
    sireName: straw.sireName,
  };
}

/** The sire of a breeding already on file, however he was recorded. */
export function sireDisplay(record: BreedingRecord, lookup: SireLookup): string | undefined {
  if (record.sireName !== undefined && record.sireName.trim() !== "") return record.sireName;

  const bull =
    record.bullId === undefined
      ? undefined
      : lookup.animals.find((animal) => animal.id === record.bullId);
  if (bull !== undefined) return displayName(bull);

  const outsider =
    record.sireExternalId === undefined
      ? undefined
      : lookup.outsiders.find((entry) => entry.id === record.sireExternalId);
  if (outsider !== undefined) return outsider.name;

  const straw =
    record.semenInventoryId === undefined
      ? undefined
      : (lookup.straws ?? []).find((entry) => entry.id === record.semenInventoryId);
  if (straw !== undefined) return straw.sireName;

  // Records written before there was a field for him: the breeding screen used
  // to put the sire in the notes because there was nowhere else to put it.
  const noted = /^Sire: (.+)$/m.exec(record.notes ?? "");
  return noted?.[1]?.trim();
}

/** Where a straw's sire is on file, if he is. */
export function strawSireRef(
  straw: Pick<SemenInventory, "sireAnimalId" | "sireExternalId">,
): SireChoice | undefined {
  if (straw.sireAnimalId !== undefined) return { kind: "bull", id: straw.sireAnimalId };
  if (straw.sireExternalId !== undefined) return { kind: "external", id: straw.sireExternalId };
  return undefined;
}
